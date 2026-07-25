// 結合試験: 実データ2,527冊に対してフルビルドの通しを確認する。
// data/output_dataへの書き込みは行わない。DBはインメモリを使い、data/db/library.dbは使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');

test('実データ2,527冊のフルビルドが全件成功し、book_keywordsも投入される', () => {
  const db = new Database(':memory:');
  initSchema(db);

  const start = Date.now();
  const summary = runFullBuild(db, OUTPUT_DATA_DIR);
  const elapsedMs = Date.now() - start;
  console.log(`フルビルド所要時間: ${elapsedMs}ms`);

  assert.equal(summary.total, 2527);
  assert.equal(summary.inserted, 2527);
  assert.equal(summary.failed.length, 0);

  const bookCount = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  assert.equal(bookCount, 2527);

  const keywordCount = db.prepare('SELECT COUNT(*) as n FROM book_keywords').get().n;
  assert.equal(keywordCount, 12656); // doc/03_specification.mdの実測値と一致

  db.close();
});

test('フォールバック系フラグが実データで期待通りの件数になる', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);

  const titleFallback = db.prepare('SELECT COUNT(*) as n FROM books WHERE title_is_fallback = 1').get().n;
  const summaryFallback = db.prepare('SELECT COUNT(*) as n FROM books WHERE summary_long_is_fallback = 1').get().n;
  assert.equal(titleFallback, 1);
  assert.equal(summaryFallback, 3);

  db.close();
});
