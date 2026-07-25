import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { getBookByFilePath, getKeywordsForBook } from '../../src/build/persist.js';

const FIXTURES_DIR = path.resolve('test/fixtures/output_data');

test('fixtures全件のフルビルド: 正常8件中6件が投入され、壊れた2件が失敗として報告される', () => {
  const db = new Database(':memory:');
  initSchema(db);

  const summary = runFullBuild(db, FIXTURES_DIR);

  assert.equal(summary.total, 8);
  assert.equal(summary.inserted, 6);
  assert.equal(summary.failed.length, 2);

  const failedFiles = summary.failed.map((f) => f.file).sort();
  assert.deepEqual(failedFiles, ['broken_missing_section.md', 'broken_no_frontmatter.md']);

  const row = db.prepare('SELECT COUNT(*) as n FROM books').get();
  assert.equal(row.n, 6);

  db.close();
});

test('フルビルド後、1冊分の内容がDBから正しく読み取れる', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_DIR);

  const book = getBookByFilePath(db, 'normal_book.md');
  assert.equal(book.title, 'テスト用の会計入門book');
  assert.ok(book.file_mtime != null && book.file_mtime !== '');
  assert.ok(book.content_hash.length === 64);

  const keywords = getKeywordsForBook(db, book.id);
  assert.equal(keywords.length, 5);

  db.close();
});

test('fullBuildはfileNameを渡すため、titleがnullの本(null_title_book.md)も投入される', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_DIR);

  const book = getBookByFilePath(db, 'null_title_book.md');
  assert.ok(book != null);
  assert.equal(book.title, 'null_title_book');
  assert.equal(book.title_is_fallback, 1);

  db.close();
});
