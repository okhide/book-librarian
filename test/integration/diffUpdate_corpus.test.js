// 結合試験: 実データに対する差分更新の冪等性、およびフルリビルドのユーザーデータ保護を確認する。
// 総件数はディレクトリの実スキャン件数と突き合わせる（parse_corpus.test.js参照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { runDiffUpdate } from '../../src/build/diffUpdate.js';
import { runFullRebuild } from '../../src/build/fullRebuild.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');
const CSV_PATH = path.resolve('data/蔵書リスト.csv');

function countMdFiles() {
  return fs.readdirSync(OUTPUT_DATA_DIR).filter((f) => f.endsWith('.md')).length;
}

test('実データ全件を投入した直後に差分更新を実行すると、全件skippedになる（冪等性）', () => {
  const expectedCount = countMdFiles();
  const db = new Database(':memory:');
  initSchema(db);
  const buildSummary = runFullBuild(db, OUTPUT_DATA_DIR);
  assert.equal(buildSummary.inserted, expectedCount);

  const diffSummary = runDiffUpdate(db, OUTPUT_DATA_DIR);
  assert.equal(diffSummary.added, 0);
  assert.equal(diffSummary.updated, 0);
  assert.equal(diffSummary.promoted, 0);
  assert.equal(diffSummary.deleted, 0);
  assert.equal(diffSummary.skipped, expectedCount);

  db.close();
});

test('実データでフルリビルドを実行してもreading_statusは保護される', () => {
  const expectedCount = countMdFiles();
  const db = new Database(':memory:');
  initSchema(db);
  db.prepare(
    "INSERT INTO reading_status (file_path, status, updated_at) VALUES ('Rstat.md', 'reading', ?)"
  ).run(new Date().toISOString());

  runFullRebuild(db, OUTPUT_DATA_DIR, CSV_PATH);

  const row = db.prepare('SELECT * FROM reading_status WHERE file_path = ?').get('Rstat.md');
  assert.ok(row != null);
  assert.equal(row.status, 'reading');

  const bookCount = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  assert.equal(bookCount, expectedCount);

  db.close();
});
