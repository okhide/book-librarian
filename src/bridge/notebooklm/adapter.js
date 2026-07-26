// NotebookLMアダプタ（Step 6.2）。BridgeAdapter形状（doc/03_specification.md）を実装する。
// notebooklm CLIの実行はすべて src/bridge/notebooklm/cli.js 経由。ここではCLIの結果を
// 使ったビジネスロジック（get-or-create・重複防止・ログイン誘導）のみを扱う。
export const NOTEBOOK_TITLE_PREFIX = '蔵書ライブラリ: ';

export function notebookTitleForTheme(theme) {
  return `${NOTEBOOK_TITLE_PREFIX}${theme}`;
}

// notebooklmの`--json`出力は将来のバージョンで`{notebooks:[...]}`と
// 素の配列のどちらの形も取りうるため、両方を許容する防御的なヘルパー。
function asArray(result, key) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result[key])) return result[key];
  return [];
}

function assertNoError(result, actionLabel) {
  if (result && result.error) {
    throw new Error(`notebooklm ${actionLabel}失敗: ${result.message}`);
  }
  return result;
}

// drive_urlは `https://drive.google.com/file/d/<FILE_ID>/view?...` 形式（蔵書リスト.csv由来）。
// source add-driveはURLではなくファイルIDを要求するため抽出する。
export function extractDriveFileId(driveUrl) {
  const match = driveUrl?.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * @param {ReturnType<import('./cli.js').createNotebookLmCli>} cli
 */
export function createNotebookLmAdapter(cli) {
  return {
    name: 'notebooklm',

    /**
     * セッションが有効か確認する。無効ならユーザーへの案内メッセージを返す
     * （ログイン実行自体はユーザー本人がターミナルで行う。詳細はdoc/06_implementation_plan.md参照）。
     */
    async checkSession() {
      const result = await cli.authCheck();
      if (result.error || result.status !== 'ok') {
        return {
          ok: false,
          message:
            'notebooklmのセッションが無効です。ターミナルで `notebooklm login` を実行してログインしてから、もう一度お試しください。',
        };
      }
      return { ok: true };
    },

    /**
     * タイトル命名規則（`蔵書ライブラリ: <テーマ名>`）で既存ノートブックを検索し、
     * 無ければ新規作成する。重複作成を避けるための唯一の入口。
     * @param {string} theme
     */
    async getOrCreateNotebook(theme) {
      const title = notebookTitleForTheme(theme);
      const listResult = assertNoError(await cli.listNotebooks(), 'list');
      const notebooks = asArray(listResult, 'notebooks');
      const existing = notebooks.find((nb) => nb.title === title);
      if (existing) return { notebook: existing, created: false };

      // create --json の実レスポンスは {notebook: {id, title, ...}} という入れ子（実機確認済み）
      const created = assertNoError(await cli.createNotebook(title), 'create');
      return { notebook: created.notebook ?? created, created: true };
    },

    /**
     * 指定ノートブックへ本を登録する（Google Drive上のPDF本体を`source add-drive`で登録）。
     * 既に同じタイトルのソースがあればスキップする（本の重複登録防止）。
     *
     * 制約: `source add-drive`成功時、ソースのタイトルはこちらが渡した値ではなく
     * Google Drive側のファイルメタデータのタイトルに上書きされる（notebooklm-py本体の
     * 既知の仕様、実機確認済み）。またDriveのファイルID自体はnotebooklmの`source list`
     * レスポンスに含まれず、こちら側からは再現できない。そのため重複検知は
     * 「本のtitleと完全一致するタイトルのソースが既にあるか」による近似判定であり、
     * Drive側のファイル名が本のtitleと異なる場合は重複を見逃す可能性がある
     * （実害は登録がスキップされず再度追加される程度で、データ破壊は無い）。
     * @param {string} notebookId
     * @param {Array<{title: string, drive_url: string|null}>} books
     */
    async registerBooksToNotebook(notebookId, books) {
      const sourceListResult = assertNoError(await cli.listSources(notebookId), 'source list');
      const existingSources = asArray(sourceListResult, 'sources');
      const existingTitles = new Set(existingSources.map((s) => s.title).filter(Boolean));

      const results = [];
      for (const book of books) {
        if (!book.drive_url) {
          results.push({ book, status: 'skipped', reason: 'drive_urlが無いため登録できません' });
          continue;
        }
        const fileId = extractDriveFileId(book.drive_url);
        if (!fileId) {
          results.push({ book, status: 'error', reason: `drive_urlからファイルIDを抽出できません: ${book.drive_url}` });
          continue;
        }
        if (existingTitles.has(book.title)) {
          results.push({ book, status: 'skipped', reason: '既に登録済み（タイトル一致）' });
          continue;
        }

        const added = await cli.addDriveSource(notebookId, fileId, book.title, { mimeType: 'pdf' });
        if (!added.ok) {
          results.push({ book, status: 'error', reason: added.raw.stderr || added.raw.stdout });
          continue;
        }
        results.push({ book, status: 'added', sourceId: added.sourceId });
        existingTitles.add(book.title);
      }
      return results;
    },

    /**
     * BridgeAdapter共通インターフェース（doc/03_specification.md）の実装。
     * セッション確認→get-or-createノートブック→重複防止付きソース登録までを一括で行う。
     * @param {{theme: string, books: Array<{title: string, drive_url: string|null}>}} params
     */
    async registerBooks({ theme, books }) {
      const session = await this.checkSession();
      if (!session.ok) return { ok: false, message: session.message };

      const { notebook, created } = await this.getOrCreateNotebook(theme);
      const results = await this.registerBooksToNotebook(notebook.id, books);
      return { ok: true, notebook, created, results };
    },

    async ask(notebookId, question, options = {}) {
      return assertNoError(await cli.ask(notebookId, question, options), 'ask');
    },

    async generateQuiz(notebookId, options = {}) {
      return assertNoError(await cli.generateQuiz(notebookId, options), 'generate quiz');
    },

    /**
     * 利用が一段落した後の後始末。新規作成したノートブックのみ削除可否の判断対象になる。
     * `notebook.title`が命名規則のプレフィックスと一致することを削除直前にも再確認する
     * （createdフラグの取り違え等のバグがあっても無関係なノートブックを削除しないための保険。
     * 実際に無関係な既存ノートブックを誤って削除する事故が起きたため導入した）。
     * @param {{id: string, title: string}} notebook
     * @param {{created: boolean, keep: boolean}} params keep: ユーザーが「残す」を選んだか
     */
    async finalize(notebook, { created, keep }) {
      if (!created) {
        return { deleted: false, reason: '既存ノートブックを再利用したため削除確認の対象外' };
      }
      if (keep) {
        return { deleted: false, reason: 'ユーザーが保持を選択' };
      }
      if (!notebook.title?.startsWith(NOTEBOOK_TITLE_PREFIX)) {
        throw new Error(
          `安全のため削除を中止: タイトル「${notebook.title}」が命名規則（${NOTEBOOK_TITLE_PREFIX}）と一致しません`
        );
      }
      const result = await cli.deleteNotebook(notebook.id);
      return { deleted: result.ok, result };
    },
  };
}
