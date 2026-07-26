// notebooklm-py CLI（実行ファイル: notebooklm）をシェルアウトで呼ぶ薄いラッパー。
// Gemini API連携（src/lib/gemini.js・src/build/readerLevelLlm.js）と同じ方針で、
// 実行関数（execFn）を注入可能にし、自動テストでは実際のCLI/外部サービスを呼ばない。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const NOTEBOOKLM_BIN = process.env.NOTEBOOKLM_BIN ?? 'notebooklm';

/**
 * 実際に子プロセスとして notebooklm を実行する既定のexecFn。
 * @param {string} bin
 * @param {string[]} args
 */
export async function defaultExecFn(bin, args) {
  return execFileAsync(bin, args, { maxBuffer: 10 * 1024 * 1024 });
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// notebooklmは認証切れ等のエラー時も終了コード非0＋JSON本文をstdoutに出す
// （`{"error": true, "code": "...", "message": "..."}`）。呼び出し側（adapter.js）が
// 成功/エラーを一律にJSONとして扱えるよう、ここでexecFnの例外を吸収してパースする。
async function runJson(args, execFn) {
  let stdout;
  try {
    ({ stdout } = await execFn(NOTEBOOKLM_BIN, args));
  } catch (err) {
    const parsed = tryParseJson(err.stdout);
    if (parsed !== null) return parsed;
    throw new Error(`notebooklmコマンド失敗 (${args.join(' ')}): ${err.stderr || err.message}`);
  }
  const parsed = tryParseJson(stdout);
  if (parsed === null) {
    throw new Error(`notebooklmの出力をJSONとして解釈できません (${args.join(' ')}): ${stdout}`);
  }
  return parsed;
}

// download系・delete系コマンドは`--json`を持たず、平文を出力する
//（`delete --json`は`No such option: --json`エラーになることを実機で確認済み）。
// JSONパースはせず生の標準出力/標準エラーとexit可否をそのまま返す。
async function runRaw(args, execFn) {
  try {
    const { stdout, stderr } = await execFn(NOTEBOOKLM_BIN, args);
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? String(err.message ?? err) };
  }
}

// notebooklmは `-n` に空文字/未指定を渡すと「現在のコンテキストのノートブック」に
// フォールバックする（--helpの記載通り）。これは呼び出し側のバグ（IDが空になった等）を
// 全く別の、しかもユーザーの既存ノートブックに対する操作にすり替えてしまう危険な仕様。
// 実際にこの事故（無関係な既存ノートブックの削除）が発生したため、notebookIdを取る
// 全メソッドの入口でstring型かつ非空であることを必須にする。
function requireNotebookId(notebookId, actionLabel) {
  if (typeof notebookId !== 'string' || notebookId.trim() === '') {
    throw new Error(
      `notebooklm ${actionLabel}: notebookIdが空です（呼び出し側のバグの可能性）。` +
        '空/未指定のIDは"現在のコンテキストのノートブック"にフォールバックし、意図しないノートブックを操作する事故につながるため、意図的に拒否している。'
    );
  }
}

/**
 * @param {(bin: string, args: string[]) => Promise<{stdout: string, stderr: string}>} [execFn]
 */
export function createNotebookLmCli(execFn = defaultExecFn) {
  return {
    authCheck: () => runJson(['auth', 'check', '--json'], execFn),
    status: () => runJson(['status', '--json'], execFn),

    listNotebooks: () => runJson(['list', '--json'], execFn),
    createNotebook: (title) => runJson(['create', title, '--json'], execFn),
    // deleteは--jsonを受け付けないため生出力。「Deleted notebook: <id>」の文言で成否を判定する
    deleteNotebook: async (notebookId) => {
      requireNotebookId(notebookId, 'delete');
      const result = await runRaw(['delete', '-n', notebookId, '-y'], execFn);
      return { ok: result.ok && /Deleted notebook/.test(result.stdout), raw: result };
    },

    // requireNotebookIdの失敗を常にPromiseのrejectとして呼び出し側に伝える必要があるため
    // （同期throwだとcatchし忘れる呼び出し側が出てくる）、notebookIdを取るメソッドは全てasyncにする。
    listSources: async (notebookId) => {
      requireNotebookId(notebookId, 'source list');
      return runJson(['source', 'list', '-n', notebookId, '--json'], execFn);
    },
    addSource: async (notebookId, content, options = {}) => {
      requireNotebookId(notebookId, 'source add');
      const args = ['source', 'add', content, '-n', notebookId, '--json'];
      if (options.title) args.push('--title', options.title);
      if (options.type) args.push('--type', options.type);
      return runJson(args, execFn);
    },
    // 汎用の`source add --type url`でGoogle DriveのURLを渡すと、Googleのボット検出で
    // CAPTCHAページが返され内容を読めない（実機検証済み）。Drive上のファイルは専用の
    // `source add-drive`（認証済みDrive APIアクセス）を使う必要がある。このコマンドは
    // --jsonを持たないため平文出力を解析する。titleは指定しても実際はDrive側の
    // メタデータのタイトルで上書きされる（notebooklm-py本体の既知の仕様）。
    addDriveSource: async (notebookId, fileId, title, options = {}) => {
      requireNotebookId(notebookId, 'source add-drive');
      const args = [
        'source',
        'add-drive',
        fileId,
        title,
        '-n',
        notebookId,
        '--mime-type',
        options.mimeType ?? 'pdf',
      ];
      const result = await runRaw(args, execFn);
      const match = result.stdout.match(/Added Drive source: (\S+)/);
      return { ok: result.ok && !!match, sourceId: match ? match[1] : null, raw: result };
    },

    ask: async (notebookId, question, options = {}) => {
      requireNotebookId(notebookId, 'ask');
      const args = ['ask', question, '-n', notebookId, '--json'];
      if (options.conversationId) args.push('-c', options.conversationId);
      for (const sourceId of options.sourceIds ?? []) args.push('-s', sourceId);
      return runJson(args, execFn);
    },

    generateQuiz: async (notebookId, options = {}) => {
      requireNotebookId(notebookId, 'generate quiz');
      const args = ['generate', 'quiz', '-n', notebookId, '--json', '--wait'];
      if (options.quantity) args.push('--quantity', options.quantity);
      if (options.difficulty) args.push('--difficulty', options.difficulty);
      for (const sourceId of options.sourceIds ?? []) args.push('-s', sourceId);
      return runJson(args, execFn);
    },
    waitForArtifact: async (notebookId, artifactId, options = {}) => {
      requireNotebookId(notebookId, 'artifact wait');
      const args = ['artifact', 'wait', artifactId, '-n', notebookId, '--json'];
      if (options.timeout) args.push('--timeout', String(options.timeout));
      return runJson(args, execFn);
    },
    downloadQuiz: async (notebookId, options = {}) => {
      requireNotebookId(notebookId, 'download quiz');
      const args = ['download', 'quiz', '-n', notebookId];
      if (options.format) args.push('--format', options.format);
      if (options.artifactId) args.push('-a', options.artifactId);
      return runRaw(args, execFn);
    },
  };
}
