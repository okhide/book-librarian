// フェイクのcli（createNotebookLmCliと同じメソッド名を持つオブジェクト）を注入して検証する。
// 実際のnotebooklmコマンドは呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotebookLmAdapter, notebookTitleForTheme } from '../../src/bridge/notebooklm/adapter.js';

function fakeCli(overrides = {}) {
  return {
    authCheck: async () => ({ status: 'ok' }),
    listNotebooks: async () => ({ notebooks: [] }),
    createNotebook: async (title) => ({ id: 'nb_new', title }),
    listSources: async () => ({ sources: [] }),
    addSource: async (notebookId, driveUrl, options) => ({ id: `src_${driveUrl}`, title: options.title }),
    deleteNotebook: async () => ({ deleted: true }),
    ask: async () => ({ answer: 'ok' }),
    generateQuiz: async () => ({ status: 'completed' }),
    ...overrides,
  };
}

test('notebookTitleForTheme: 固定命名規則になる', () => {
  assert.equal(notebookTitleForTheme('会計'), '蔵書ライブラリ: 会計');
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
      return { id: 'nb_new' };
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

test('registerBooksToNotebook: 既存ソースと同じdrive_urlの本はスキップされる（重複防止）', async () => {
  const cli = fakeCli({
    listSources: async () => ({ sources: [{ drive_url: 'https://drive.example/a', title: '本A' }] }),
  });
  const adapter = createNotebookLmAdapter(cli);
  const results = await adapter.registerBooksToNotebook('nb1', [
    { title: '本A', drive_url: 'https://drive.example/a' },
  ]);
  assert.equal(results[0].status, 'skipped');
  assert.match(results[0].reason, /既に登録済み/);
});

test('registerBooksToNotebook: 新規の本はaddSourceが呼ばれ、以降の重複チェックにも反映される', async () => {
  const addedCalls = [];
  const cli = fakeCli({
    addSource: async (notebookId, driveUrl, options) => {
      addedCalls.push({ notebookId, driveUrl, options });
      return { id: 'src1' };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  const results = await adapter.registerBooksToNotebook('nb1', [
    { title: '本A', drive_url: 'https://drive.example/a' },
    { title: '本A', drive_url: 'https://drive.example/a' }, // 同一バッチ内の重複も2件目でスキップされるべき
  ]);
  assert.equal(results[0].status, 'added');
  assert.equal(results[1].status, 'skipped');
  assert.equal(addedCalls.length, 1);
});

test('registerBooksToNotebook: addSourceがエラーを返した本はerrorステータスになる', async () => {
  const cli = fakeCli({ addSource: async () => ({ error: true, message: '容量制限' }) });
  const adapter = createNotebookLmAdapter(cli);
  const results = await adapter.registerBooksToNotebook('nb1', [
    { title: '本A', drive_url: 'https://drive.example/a' },
  ]);
  assert.equal(results[0].status, 'error');
  assert.equal(results[0].reason, '容量制限');
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
    books: [{ title: '本A', drive_url: 'https://drive.example/a' }],
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
      return { deleted: true };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  const result = await adapter.finalize('nb1', { created: false, keep: false });
  assert.equal(result.deleted, false);
  assert.equal(deleteCalled, false);
});

test('finalize: 新規作成でkeep=trueなら削除しない', async () => {
  const adapter = createNotebookLmAdapter(fakeCli());
  const result = await adapter.finalize('nb1', { created: true, keep: true });
  assert.equal(result.deleted, false);
});

test('finalize: 新規作成でkeep=falseならdeleteNotebookを呼ぶ', async () => {
  let deleteCalled = false;
  const cli = fakeCli({
    deleteNotebook: async () => {
      deleteCalled = true;
      return { deleted: true };
    },
  });
  const adapter = createNotebookLmAdapter(cli);
  const result = await adapter.finalize('nb1', { created: true, keep: false });
  assert.equal(result.deleted, true);
  assert.equal(deleteCalled, true);
});
