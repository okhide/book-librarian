// フェイクのcli（createNotebookLmCliと同じメソッド名を持つオブジェクト）を注入して検証する。
// 実際のnotebooklmコマンドは呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotebookLmAdapter, notebookTitleForTheme, extractDriveFileId } from '../../src/bridge/notebooklm/adapter.js';

const DRIVE_URL_A = 'https://drive.google.com/file/d/FILE_ID_A/view?usp=drivesdk';
const DRIVE_URL_B = 'https://drive.google.com/file/d/FILE_ID_B/view?usp=drivesdk';

// createNotebook/addDriveSourceのレスポンス形状は実機確認済み
// （create: {notebook:{...}}という入れ子、add-drive: --jsonが無く平文出力を
//  cli.js側で{ok, sourceId, raw}に正規化済み、という前提で組む）。
function fakeCli(overrides = {}) {
  return {
    authCheck: async () => ({ status: 'ok' }),
    listNotebooks: async () => ({ notebooks: [] }),
    createNotebook: async (title) => ({ notebook: { id: 'nb_new', title } }),
    listSources: async () => ({ sources: [] }),
    addDriveSource: async (notebookId, fileId) => ({ ok: true, sourceId: `src_${fileId}`, raw: {} }),
    deleteNotebook: async () => ({ ok: true }),
    ask: async () => ({ answer: 'ok' }),
    generateQuiz: async () => ({ status: 'completed' }),
    ...overrides,
  };
}

test('notebookTitleForTheme: 固定命名規則になる', () => {
  assert.equal(notebookTitleForTheme('会計'), '蔵書ライブラリ: 会計');
});

test('extractDriveFileId: /file/d/<ID>/view形式からファイルIDを抽出する', () => {
  assert.equal(extractDriveFileId(DRIVE_URL_A), 'FILE_ID_A');
});

test('extractDriveFileId: 形式が違う/nullなら抽出できない', () => {
  assert.equal(extractDriveFileId('https://example.com/not-a-drive-url'), null);
  assert.equal(extractDriveFileId(null), null);
});

test('checkSession: authCheckがokならok:true', async () => {
  const adapter = createNotebookLmAdapter(fakeCli());
  const result = await adapter.checkSession();
  assert.equal(result.ok, true);
});

test('checkSession: 認証エラーならok:falseとログイン案内メッセージを返す', async () => {
  const cli = fakeCli({ authCheck: async () => ({ error: true, message: 'Authentication expired or invalid.' }) });
  const adapter = createNotebookLmAdapter(cli);
  const result = await adapter.checkSession();
  assert.equal(result.ok, false);
  assert.match(result.message, /notebooklm login/);
});

test('getOrCreateNotebook: 同一タイトルが既存ならそれを再利用し、新規作成しない', async () => {
  let createCalled = false;
  const cli = fakeCli({
    listNotebooks: async () => ({ notebooks: [{ id: 'nb1', title: '蔵書ライブラリ: 会計' }] }),
    createNotebook: async () => {
      createCalled = true;
      return { notebook: { id: 'nb_new' } };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  const { notebook, created } = await adapter.getOrCreateNotebook('会計');
  assert.equal(notebook.id, 'nb1');
  assert.equal(created, false);
  assert.equal(createCalled, false);
});

test('getOrCreateNotebook: 同一タイトルが無ければ新規作成する', async () => {
  const cli = fakeCli({ listNotebooks: async () => ({ notebooks: [] }) });
  const adapter = createNotebookLmAdapter(cli);
  const { notebook, created } = await adapter.getOrCreateNotebook('会計');
  assert.equal(notebook.title, '蔵書ライブラリ: 会計');
  assert.equal(created, true);
});

test('registerBooksToNotebook: drive_urlが無い本はスキップされる', async () => {
  const adapter = createNotebookLmAdapter(fakeCli());
  const results = await adapter.registerBooksToNotebook('nb1', [{ title: '本A', drive_url: null }]);
  assert.equal(results[0].status, 'skipped');
  assert.match(results[0].reason, /drive_url/);
});

test('registerBooksToNotebook: drive_urlからファイルIDを抽出できない場合はerror', async () => {
  const adapter = createNotebookLmAdapter(fakeCli());
  const results = await adapter.registerBooksToNotebook('nb1', [
    { title: '本A', drive_url: 'https://example.com/not-a-drive-url' },
  ]);
  assert.equal(results[0].status, 'error');
  assert.match(results[0].reason, /ファイルID/);
});

test('registerBooksToNotebook: 既存ソースと同じタイトルの本はスキップされる（重複防止）', async () => {
  const cli = fakeCli({
    listSources: async () => ({ sources: [{ title: '本A', url: null }] }),
  });
  const adapter = createNotebookLmAdapter(cli);
  const results = await adapter.registerBooksToNotebook('nb1', [{ title: '本A', drive_url: DRIVE_URL_A }]);
  assert.equal(results[0].status, 'skipped');
  assert.match(results[0].reason, /既に登録済み/);
});

test('registerBooksToNotebook: 新規の本はaddDriveSourceが呼ばれ、以降の重複チェックにも反映される', async () => {
  const addedCalls = [];
  const cli = fakeCli({
    addDriveSource: async (notebookId, fileId, title, options) => {
      addedCalls.push({ notebookId, fileId, title, options });
      return { ok: true, sourceId: 'src1', raw: {} };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  const results = await adapter.registerBooksToNotebook('nb1', [
    { title: '本A', drive_url: DRIVE_URL_A },
    { title: '本A', drive_url: DRIVE_URL_A }, // 同一バッチ内の重複も2件目でスキップされるべき
  ]);
  assert.equal(results[0].status, 'added');
  assert.equal(results[1].status, 'skipped');
  assert.equal(addedCalls.length, 1);
  assert.equal(addedCalls[0].fileId, 'FILE_ID_A');
  assert.equal(addedCalls[0].options.mimeType, 'pdf');
});

test('registerBooksToNotebook: addDriveSourceが失敗した本はerrorステータスになる', async () => {
  const cli = fakeCli({
    addDriveSource: async () => ({ ok: false, sourceId: null, raw: { stderr: 'Error: Invalid source data: None' } }),
  });
  const adapter = createNotebookLmAdapter(cli);
  const results = await adapter.registerBooksToNotebook('nb1', [{ title: '本A', drive_url: DRIVE_URL_A }]);
  assert.equal(results[0].status, 'error');
  assert.match(results[0].reason, /Invalid source data/);
});

test('registerBooks: セッション無効なら通知だけしてノートブック操作は行わない', async () => {
  let listCalled = false;
  const cli = fakeCli({
    authCheck: async () => ({ error: true, message: 'expired' }),
    listNotebooks: async () => {
      listCalled = true;
      return { notebooks: [] };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  const result = await adapter.registerBooks({ theme: '会計', books: [] });
  assert.equal(result.ok, false);
  assert.equal(listCalled, false);
});

test('registerBooks: 正常系はnotebook・created・resultsを返す', async () => {
  const adapter = createNotebookLmAdapter(fakeCli());
  const result = await adapter.registerBooks({
    theme: '会計',
    books: [{ title: '本A', drive_url: DRIVE_URL_A }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.results[0].status, 'added');
});

test('finalize: 既存ノートブック再利用時は削除確認自体が不要', async () => {
  let deleteCalled = false;
  const cli = fakeCli({
    deleteNotebook: async () => {
      deleteCalled = true;
      return { ok: true };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  const result = await adapter.finalize({ id: 'nb1', title: '無関係な既存ノートブック' }, { created: false, keep: false });
  assert.equal(result.deleted, false);
  assert.equal(deleteCalled, false);
});

test('finalize: 新規作成でkeep=trueなら削除しない', async () => {
  const adapter = createNotebookLmAdapter(fakeCli());
  const result = await adapter.finalize(
    { id: 'nb1', title: '蔵書ライブラリ: 会計' },
    { created: true, keep: true }
  );
  assert.equal(result.deleted, false);
});

test('finalize: 新規作成でkeep=falseならdeleteNotebookを呼ぶ', async () => {
  let deleteCalled = false;
  const cli = fakeCli({
    deleteNotebook: async () => {
      deleteCalled = true;
      return { ok: true };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  const result = await adapter.finalize(
    { id: 'nb1', title: '蔵書ライブラリ: 会計' },
    { created: true, keep: false }
  );
  assert.equal(result.deleted, true);
  assert.equal(deleteCalled, true);
});

test('finalize: タイトルが命名規則プレフィックスと一致しない場合は削除を拒否する（createdフラグ取り違え等への保険）', async () => {
  let deleteCalled = false;
  const cli = fakeCli({
    deleteNotebook: async () => {
      deleteCalled = true;
      return { ok: true };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  await assert.rejects(
    () => adapter.finalize({ id: 'nb1', title: '本 : 趣味・教養' }, { created: true, keep: false }),
    /命名規則/
  );
  assert.equal(deleteCalled, false);
});
