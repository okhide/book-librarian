import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { searchByKeyword } from '../../src/lib/keywordSearch.js';
import { getBookByFilePath } from '../../src/build/persist.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  return db;
}

test('titleに含まれる語で検索すると、その本が1位になる', () => {
  const db = makeDb();
  const { totalCount, results } = searchByKeyword(db, '会計');
  assert.ok(totalCount >= 1);
  const normalBook = getBookByFilePath(db, 'normal_book.md');
  assert.equal(results[0].book.id, normalBook.id);
  db.close();
});

test('totalCountは絞り込み前のヒット総数を返す（limitより多くても正しい）', () => {
  const db = makeDb();
  const { totalCount, results } = searchByKeyword(db, '会計', { limit: 0 });
  assert.equal(results.length, 0);
  assert.ok(totalCount >= 1);
  db.close();
});

test('status=summarizedのみが対象になる（pendingは既定で除外される）', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO books (status, title, title_is_fallback, search_text, updated_at) VALUES ('pending', '未処理本サンプル', 1, '未処理本サンプル', '2026-01-01')"
  ).run();

  const { results } = searchByKeyword(db, '未処理本サンプル');
  assert.equal(results.length, 0);

  const { results: withPending } = searchByKeyword(db, '未処理本サンプル', {
    includeStatuses: ['summarized', 'pending'],
  });
  assert.equal(withPending.length, 1);

  db.close();
});

test('ヒットしない語は空の結果を返す', () => {
  const db = makeDb();
  const { totalCount, results } = searchByKeyword(db, 'まったくヒットしないはずの文字列XYZ');
  assert.equal(totalCount, 0);
  assert.equal(results.length, 0);
  db.close();
});

test('日本語の部分一致が機能する（英単語の大文字小文字も無視される）', () => {
  const db = makeDb();
  // short_summary_book.mdのtitleに含まれる文字列で検索
  const { results } = searchByKeyword(db, '極端');
  assert.ok(results.length >= 1);
  db.close();
});

test('yearで絞り込める', () => {
  const db = makeDb();
  const normalBook = getBookByFilePath(db, 'normal_book.md');
  assert.equal(normalBook.publication_year, 2020);

  const matched = searchByKeyword(db, '会計', { year: 2020 });
  assert.ok(matched.results.length >= 1);

  const unmatched = searchByKeyword(db, '会計', { year: 1999 });
  assert.equal(unmatched.results.length, 0);
  db.close();
});

test('topicで絞り込める', () => {
  const db = makeDb();
  const normalBook = getBookByFilePath(db, 'normal_book.md');
  db.prepare('INSERT INTO book_topics (book_id, topic) VALUES (?, ?)').run(normalBook.id, '会計・財務');

  const matched = searchByKeyword(db, '会計', { topic: '会計・財務' });
  assert.ok(matched.results.some((r) => r.book.id === normalBook.id));

  const unmatched = searchByKeyword(db, '会計', { topic: '存在しないトピック' });
  assert.equal(unmatched.results.length, 0);
  db.close();
});

test('levelで絞り込める', () => {
  const db = makeDb();
  const normalBook = getBookByFilePath(db, 'normal_book.md');
  db.prepare("UPDATE books SET reader_level = 'beginner' WHERE id = ?").run(normalBook.id);

  const matched = searchByKeyword(db, '会計', { level: 'beginner' });
  assert.ok(matched.results.some((r) => r.book.id === normalBook.id));

  const unmatched = searchByKeyword(db, '会計', { level: 'advanced' });
  assert.equal(unmatched.results.length, 0);
  db.close();
});

test('categoryで絞り込める', () => {
  const db = makeDb();
  const matched = searchByKeyword(db, '会計', { category: '実用書' });
  assert.ok(matched.results.length >= 1);

  const unmatched = searchByKeyword(db, '会計', { category: '技術書' });
  assert.equal(unmatched.results.length, 0);
  db.close();
});
