import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { insertBook, getBookByFilePath, getKeywordsForBook } from '../../src/build/persist.js';
import { parseBookMarkdown } from '../../src/build/parse.js';

const FIXTURES_DIR = path.resolve('test/fixtures/output_data');

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

test('スキーマ作成後、全テーブルが存在する', () => {
  const db = makeDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  for (const expected of ['books', 'book_keywords', 'book_topics', 'book_embeddings', 'reading_status']) {
    assert.ok(tables.includes(expected), `テーブル ${expected} が存在しない`);
  }
  db.close();
});

test('1冊分のデータをINSERTしてSELECTで全フィールドが往復する', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
  assert.equal(parsed.ok, true);

  const bookId = insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });

  const row = getBookByFilePath(db, 'normal_book.md');
  assert.equal(row.id, bookId);
  assert.equal(row.title, 'テスト用の会計入門book');
  assert.equal(row.author, '山田太郎');
  assert.equal(row.status, 'summarized');
  assert.equal(row.title_is_fallback, 0);
  assert.equal(row.summary_long_is_fallback, 0);
  assert.equal(row.reliability, 3);
  assert.equal(row.publication_year, 2020);
  assert.ok(row.search_text.includes('会計'));
  assert.ok(row.embed_source_hash.length === 64); // sha256 hex
  assert.equal(row.updated_at != null, true);

  db.close();
});

test('keywordsがbook_keywordsに正しく分解される', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });

  const bookId = insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });

  const keywords = getKeywordsForBook(db, bookId);
  assert.deepEqual(keywords, ['会計', '簿記', '決算', '財務', '経営']);
  db.close();
});

test('titleがフォールバックされた本はtitle_is_fallback=1で保存される', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'null_title_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'null_title_book.md' });
  assert.equal(parsed.ok, true);

  insertBook(db, {
    filePath: 'null_title_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });

  const row = getBookByFilePath(db, 'null_title_book.md');
  assert.equal(row.title, 'null_title_book');
  assert.equal(row.title_is_fallback, 1);
  db.close();
});

test('reading_statusテーブルは空のまま独立して存在し、booksの挿入に影響されない', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO reading_status (file_path, status, updated_at) VALUES ('x.md', 'unread', '2026-01-01')"
  ).run();

  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
  insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });

  const readingRow = db.prepare('SELECT * FROM reading_status WHERE file_path = ?').get('x.md');
  assert.equal(readingRow.status, 'unread');
  db.close();
});
