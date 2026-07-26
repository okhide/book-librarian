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

// download系コマンドは`--json`を持たず、ファイル内容そのものを出力する。
// JSONパースはせず生の標準出力/標準エラーとexit可否をそのまま返す。
async function runRaw(args, execFn) {
  try {
    const { stdout, stderr } = await execFn(NOTEBOOKLM_BIN, args);
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? String(err.message ?? err) };
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
    deleteNotebook: (notebookId) => runJson(['delete', '-n', notebookId, '-y', '--json'], execFn),

    listSources: (notebookId) => runJson(['source', 'list', '-n', notebookId, '--json'], execFn),
    addSource: (notebookId, content, options = {}) => {
      const args = ['source', 'add', content, '-n', notebookId, '--json'];
      if (options.title) args.push('--title', options.title);
      if (options.type) args.push('--type', options.type);
      return runJson(args, execFn);
    },

    ask: (notebookId, question, options = {}) => {
      const args = ['ask', question, '-n', notebookId, '--json'];
      if (options.conversationId) args.push('-c', options.conversationId);
      for (const sourceId of options.sourceIds ?? []) args.push('-s', sourceId);
      return runJson(args, execFn);
    },

    generateQuiz: (notebookId, options = {}) => {
      const args = ['generate', 'quiz', '-n', notebookId, '--json', '--wait'];
      if (options.quantity) args.push('--quantity', options.quantity);
      if (options.difficulty) args.push('--difficulty', options.difficulty);
      for (const sourceId of options.sourceIds ?? []) args.push('-s', sourceId);
      return runJson(args, execFn);
    },
    waitForArtifact: (notebookId, artifactId, options = {}) => {
      const args = ['artifact', 'wait', artifactId, '-n', notebookId, '--json'];
      if (options.timeout) args.push('--timeout', String(options.timeout));
      return runJson(args, execFn);
    },
    downloadQuiz: (notebookId, options = {}) => {
      const args = ['download', 'quiz', '-n', notebookId];
      if (options.format) args.push('--format', options.format);
      if (options.artifactId) args.push('-a', options.artifactId);
      return runRaw(args, execFn);
    },
  };
}
