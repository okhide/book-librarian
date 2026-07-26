// 結合試験: 実データ全冊に対してフルビルドの通しを確認する。
// data/output_dataへの書き込みは行わない。DBはインメモリを使い、data/db/library.dbは使わない。
// 総件数はディレクトリの実スキャン件数と突き合わせる（parse_corpus.test.js参照。
// data/output_dataは元プロジェクト側で件数が増減しうるため決め打ちしない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');

test('実データ全冊のフルビルドが全件成功し、book_keywordsも投入される', () => {
  const expectedCount = fs.readdirSync(OUTPUT_DATA_DIR).filter((f) => f.endsWith('.md')).length;

  const db = new Database(':memory:');
  initSchema(db);

  const start = Date.now();
  const summary = runFullBuild(db, OUTPUT_DATA_DIR);
  const elapsedMs = Date.now() - start;
  console.log(`フルビルド所要時間: ${elapsedMs}ms (${expectedCount}冊)`);

  assert.equal(summary.total, expectedCount);
  assert.equal(summary.inserted, expectedCount);
  assert.equal(summary.failed.length, 0);

  const bookCount = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  assert.equal(bookCount, expectedCount);

  const keywordCount = db.prepare('SELECT COUNT(*) as n FROM book_keywords').get().n;
  console.log(`book_keywords件数: ${keywordCount} (1冊あたり平均${(keywordCount / expectedCount).toFixed(2)}語)`);
  // doc/03_specification.mdの実測値(2,527冊で12,656件、約5.0語/冊)を基準に、
  // 1冊あたりの平均語数が大きく崩れていないことだけを確認する（絶対数は決め打ちしない）
  const avgPerBook = keywordCount / expectedCount;
  assert.ok(avgPerBook > 3 && avgPerBook < 8, `1冊あたりのkeyword数が想定外: ${avgPerBook.toFixed(2)}`);

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
