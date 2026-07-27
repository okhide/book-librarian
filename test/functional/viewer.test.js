// 実際の埋め込みモデルとExpressサーバーを起動して検証するため、unitではなくfunctionalに置く
// （test/functional/hybridSearch.test.jsと同じ方針）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder } from '../../src/lib/embed.js';
import { createApp } from '../../src/viewer/server.js';
import { getReadingStatus } from '../../src/lib/readingStatus.js';
import { getBookByFilePath } from '../../src/build/persist.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

async function makeServer(extractor) {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  await generateMissingEmbeddings(db, extractor);

  const app = createApp(db, extractor);
  const server = app.listen(0);
  const port = server.address().port;
  return { db, server, base: `http://127.0.0.1:${port}` };
}

test('ビューア/エディタ', async (t) => {
  const extractor = await createEmbedder();

  await t.test('GET / は検索フォームを返す', async () => {
    const { db, server, base } = await makeServer(extractor);
    const res = await fetch(base + '/');
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /<form class="search-form"/);
    server.close();
    db.close();
  });

  await t.test('GET /search はキーワードに一致する本を含む断片を返す', async () => {
    const { db, server, base } = await makeServer(extractor);
    const normalBook = getBookByFilePath(db, 'normal_book.md');
    const res = await fetch(base + '/search?q=会計');
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(text.includes(`/books/${normalBook.id}`));
    server.close();
    db.close();
  });

  await t.test('GET /search はqが空なら何も返さない', async () => {
    const { db, server, base } = await makeServer(extractor);
    const res = await fetch(base + '/search?q=');
    const text = await res.text();
    assert.equal(text, '');
    server.close();
    db.close();
  });

  await t.test('GET /books/:id は詳細ページを返し、drive_urlがあればクリック可能リンクになる', async () => {
    const { db, server, base } = await makeServer(extractor);
    const bookWithDrive = db
      .prepare("SELECT id FROM books WHERE drive_url IS NOT NULL AND drive_url != '' LIMIT 1")
      .get();
    assert.ok(bookWithDrive, '前提: drive_urlを持つ本がfixturesに存在する');

    const res = await fetch(`${base}/books/${bookWithDrive.id}`);
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /<a class="drive-link" href="[^"]+" target="_blank"/);
    server.close();
    db.close();
  });

  await t.test('GET /books/:id は存在しないidに404を返す', async () => {
    const { db, server, base } = await makeServer(extractor);
    const res = await fetch(base + '/books/999999');
    assert.equal(res.status, 404);
    server.close();
    db.close();
  });

  await t.test('POST /books/:id/reading-status は不正なstatusを拒否する', async () => {
    const { db, server, base } = await makeServer(extractor);
    const book = db.prepare('SELECT id FROM books LIMIT 1').get();
    const res = await fetch(`${base}/books/${book.id}/reading-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: 'no-such-status' }),
    });
    assert.equal(res.status, 400);
    server.close();
    db.close();
  });

  await t.test('POST /books/:id/reading-status はreading_statusのみを更新し、booksテーブルには影響しない', async () => {
    const { db, server, base } = await makeServer(extractor);
    const book = db.prepare('SELECT id, file_path, title FROM books LIMIT 1').get();

    const res = await fetch(`${base}/books/${book.id}/reading-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: 'finished', rating: '5', note: '良書だった' }),
    });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(text.includes('<span>保存しました</span>'), 'メッセージが二重エスケープされている');
    assert.match(text, /<option value="finished" selected>/);

    const persisted = getReadingStatus(db, book.file_path);
    assert.equal(persisted.status, 'finished');
    assert.equal(persisted.rating, 5);
    assert.equal(persisted.note, '良書だった');

    const titleAfter = db.prepare('SELECT title FROM books WHERE id = ?').get(book.id).title;
    assert.equal(titleAfter, book.title);

    server.close();
    db.close();
  });

  await t.test('GET /books/:id は既定で閲覧モード（編集リンクを表示、入力欄は無い）', async () => {
    const { db, server, base } = await makeServer(extractor);
    const book = db.prepare('SELECT id FROM books LIMIT 1').get();
    const res = await fetch(`${base}/books/${book.id}`);
    const text = await res.text();
    assert.match(text, /編集モードに切り替え/);
    assert.ok(!text.includes('<textarea name="summaryLong"'));
    server.close();
    db.close();
  });

  await t.test('GET /books/:id?mode=edit は編集モード（入力欄を表示）', async () => {
    const { db, server, base } = await makeServer(extractor);
    const book = db.prepare('SELECT id FROM books LIMIT 1').get();
    const res = await fetch(`${base}/books/${book.id}?mode=edit`);
    const text = await res.text();
    assert.match(text, /閲覧モードに戻る/);
    assert.ok(text.includes('<textarea name="summaryLong"'));
    assert.ok(text.includes('<input type="text" name="title"'));
    // 編集不可の列は編集モードでも入力欄にならない
    // （name="status"は既存の読書状態フォーム（reading_status.status）で正当に使われているため、
    //  ここではbooks.file_pathの不在だけを確認する）
    assert.ok(!text.includes('name="filePath"'));
    server.close();
    db.close();
  });

  await t.test('POST /books/:id/edit は書誌情報・要約・reader_levelを更新する', async () => {
    const { db, server, base } = await makeServer(extractor);
    const book = db.prepare('SELECT id, file_path, status FROM books LIMIT 1').get();

    const res = await fetch(`${base}/books/${book.id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        title: 'viewerから編集したタイトル',
        author: '編集後著者',
        publisher: '',
        series: '',
        edition: '',
        isbn: '',
        publicationDate: '',
        publicationYear: '2024',
        categoryRaw: '',
        reliability: '2',
        driveUrl: '',
        summaryLong: '編集後の長い要約',
        summaryShort: '編集後の短い要約',
        readerLevel: 'advanced',
      }),
      redirect: 'manual',
    });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /mode=edit&saved=1/);

    const row = db.prepare('SELECT * FROM books WHERE id = ?').get(book.id);
    assert.equal(row.title, 'viewerから編集したタイトル');
    assert.equal(row.author, '編集後著者');
    assert.equal(row.publication_year, 2024);
    assert.equal(row.reliability, 2);
    assert.equal(row.reader_level, 'advanced');
    assert.equal(row.summary_long, '編集後の長い要約');
    // file_path/statusのような編集不可列は変化しない
    assert.equal(row.file_path, book.file_path);
    assert.equal(row.status, book.status);

    server.close();
    db.close();
  });

  await t.test('POST /books/:id/edit は不正なreader_levelを拒否する', async () => {
    const { db, server, base } = await makeServer(extractor);
    const book = db.prepare('SELECT id FROM books LIMIT 1').get();
    const res = await fetch(`${base}/books/${book.id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: 'x', summaryLong: 'y', summaryShort: 'z', readerLevel: 'no-such-level' }),
    });
    assert.equal(res.status, 400);
    server.close();
    db.close();
  });

  await t.test('POST /books/:id/edit は不正なreliability(範囲外)を拒否する', async () => {
    const { db, server, base } = await makeServer(extractor);
    const book = db.prepare('SELECT id FROM books LIMIT 1').get();
    const res = await fetch(`${base}/books/${book.id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: 'x', summaryLong: 'y', summaryShort: 'z', reliability: '99' }),
    });
    assert.equal(res.status, 400);
    server.close();
    db.close();
  });

  await t.test('未読のみフィルタで既読にした本が除外される', async () => {
    const { db, server, base } = await makeServer(extractor);
    const normalBook = getBookByFilePath(db, 'normal_book.md');

    const before = await fetch(`${base}/search?q=会計&unread=on`);
    const beforeText = await before.text();
    assert.ok(beforeText.includes(`/books/${normalBook.id}`));

    await fetch(`${base}/books/${normalBook.id}/reading-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: 'finished' }),
    });

    const after = await fetch(`${base}/search?q=会計&unread=on`);
    const afterText = await after.text();
    assert.ok(!afterText.includes(`/books/${normalBook.id}`));

    server.close();
    db.close();
  });
});
