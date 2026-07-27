import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import {
  insertBook,
  updateBook,
  getBookByFilePath,
  getKeywordsForBook,
  updateBookEditableFields,
} from '../../src/build/persist.js';
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

test('updateBook: isbnが変わると補完済みデータ(enriched_*)がリセットされる', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
  const bookId = insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });

  db.prepare(
    "UPDATE books SET enriched_isbn = '9784000000000', enriched_ndc = '123', enriched_source = 'ndl_isbn', enrichment_status = 'matched' WHERE id = ?"
  ).run(bookId);
  db.prepare(
    "INSERT INTO enrichment_candidates (file_path, status, source, created_at) VALUES ('normal_book.md', 'not_found', 'ndl_title', '2026-01-01')"
  ).run();

  const changedParsed = { ...parsed.data, isbn: parsed.data.isbn === '9999999999999' ? '8888888888888' : '9999999999999' };
  updateBook(db, bookId, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-02T00:00:00.000Z',
    contentHash: 'dummyhash2',
    parsed: changedParsed,
  });

  const row = getBookByFilePath(db, 'normal_book.md');
  assert.equal(row.enriched_isbn, null);
  assert.equal(row.enriched_ndc, null);
  assert.equal(row.enriched_source, null);
  assert.equal(row.enrichment_status, null);
  const candidate = db.prepare('SELECT * FROM enrichment_candidates WHERE file_path = ?').get('normal_book.md');
  assert.equal(candidate, undefined);
  db.close();
});

test('updateBook: isbn・titleが変わらなければ補完済みデータは維持される', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
  const bookId = insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });

  db.prepare(
    "UPDATE books SET enriched_isbn = '9784000000000', enriched_ndc = '123', enriched_source = 'ndl_isbn', enrichment_status = 'matched' WHERE id = ?"
  ).run(bookId);

  // summary等はテスト用に別値へ変えるが、isbn・titleは変えない
  const changedParsed = { ...parsed.data, summaryLong: '更新後の要約本文' };
  updateBook(db, bookId, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-02T00:00:00.000Z',
    contentHash: 'dummyhash2',
    parsed: changedParsed,
  });

  const row = getBookByFilePath(db, 'normal_book.md');
  assert.equal(row.enriched_isbn, '9784000000000');
  assert.equal(row.enrichment_status, 'matched');
  db.close();
});

test('updateBookEditableFields: 書誌情報・要約・reader_levelを更新し、search_textを再合成する', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
  const bookId = insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });
  const before = getBookByFilePath(db, 'normal_book.md');
  const keywordsBefore = getKeywordsForBook(db, bookId);

  const updated = updateBookEditableFields(db, bookId, {
    title: '手編集後のタイトル',
    author: '手編集後の著者',
    publisher: '手編集後の出版社',
    readerLevel: 'advanced',
    reliability: 2,
  });

  assert.equal(updated.title, '手編集後のタイトル');
  assert.equal(updated.author, '手編集後の著者');
  assert.equal(updated.publisher, '手編集後の出版社');
  assert.equal(updated.reader_level, 'advanced');
  assert.equal(updated.reliability, 2);
  assert.match(updated.search_text, /手編集後のタイトル/);

  // 触れていない列は変化しない
  assert.equal(updated.file_path, before.file_path);
  assert.equal(updated.status, before.status);
  assert.equal(updated.content_hash, before.content_hash);
  assert.deepEqual(getKeywordsForBook(db, bookId), keywordsBefore);

  db.close();
});

test('updateBookEditableFields: isbnが変わると補完済みデータ(enriched_*)がリセットされる', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
  const bookId = insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });
  db.prepare(
    "UPDATE books SET enriched_isbn = '9784000000000', enriched_ndc = '123', enriched_source = 'ndl_isbn', enrichment_status = 'matched' WHERE id = ?"
  ).run(bookId);

  const updated = updateBookEditableFields(db, bookId, { isbn: '9999999999999' });

  assert.equal(updated.isbn, '9999999999999');
  assert.equal(updated.enriched_isbn, null);
  assert.equal(updated.enrichment_status, null);
  db.close();
});

test('updateBookEditableFields: isbn・titleを変えなければ補完済みデータは維持される', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
  const bookId = insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });
  db.prepare(
    "UPDATE books SET enriched_isbn = '9784000000000', enrichment_status = 'matched' WHERE id = ?"
  ).run(bookId);

  const updated = updateBookEditableFields(db, bookId, { publisher: '別の出版社' });

  assert.equal(updated.enriched_isbn, '9784000000000');
  assert.equal(updated.enrichment_status, 'matched');
  db.close();
});

test('updateBookEditableFields: 要約を変えるとembed_source_hashが変わり、古い埋め込みが削除される', () => {
  const db = makeDb();
  const rawText = fs.readFileSync(path.join(FIXTURES_DIR, 'normal_book.md'), 'utf8');
  const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
  const bookId = insertBook(db, {
    filePath: 'normal_book.md',
    fileMtime: '2026-01-01T00:00:00.000Z',
    contentHash: 'dummyhash',
    parsed: parsed.data,
  });
  db.prepare('INSERT INTO book_embeddings (book_id, embedding, dim, model) VALUES (?, ?, 4, ?)').run(
    bookId,
    Buffer.from(new Float32Array([0, 0, 0, 0]).buffer),
    'dummy-model'
  );
  const before = getBookByFilePath(db, 'normal_book.md');

  updateBookEditableFields(db, bookId, { summaryLong: '全く違う要約本文にする' });

  const after = getBookByFilePath(db, 'normal_book.md');
  assert.notEqual(after.embed_source_hash, before.embed_source_hash);
  const embedding = db.prepare('SELECT * FROM book_embeddings WHERE book_id = ?').get(bookId);
  assert.equal(embedding, undefined, '要約が変わったのに古い埋め込みが残っている');
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
