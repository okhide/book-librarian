// 結合試験: 実データのoutput_data(2,527件)と蔵書リスト.csv(2,528行)の突き合わせ。
// 実測（doc/04_design.mdチェックリスト）: CSVは2,528行、output_dataは2,527ファイル。
// この結合試験でその差の理由（重複ファイル名1件）を検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { parseCatalogCsv } from '../../src/build/csv.js';
import { reconcileCatalog } from '../../src/build/reconcileCsv.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');
const CSV_PATH = path.resolve('data/蔵書リスト.csv');

test('実データの突き合わせ: 全2,527冊がsummarizedのまま残り、pendingは発生しない', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const buildSummary = runFullBuild(db, OUTPUT_DATA_DIR);
  assert.equal(buildSummary.inserted, 2527);

  const rawText = fs.readFileSync(CSV_PATH, 'utf8');
  const { rows, warnings } = parseCatalogCsv(rawText);
  assert.equal(warnings.length, 0);
  assert.equal(rows.length, 2528);

  const summary = reconcileCatalog(db, rows);

  // CSV行数2,528に対しユニークファイル名は2,527（重複1件）。
  // その2,527件すべてがoutput_dataと一致するため、pendingは0件のはず。
  assert.equal(summary.pendingInserted, 0);
  assert.equal(summary.matched, 2527);

  const totalBooks = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  assert.equal(totalBooks, 2527);

  const pendingCount = db.prepare("SELECT COUNT(*) as n FROM books WHERE status = 'pending'").get().n;
  assert.equal(pendingCount, 0);

  db.close();
});

test('csv_serialが全summarized本に設定される', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);
  const rawText = fs.readFileSync(CSV_PATH, 'utf8');
  const { rows } = parseCatalogCsv(rawText);
  reconcileCatalog(db, rows);

  const missing = db.prepare('SELECT COUNT(*) as n FROM books WHERE csv_serial IS NULL').get().n;
  assert.equal(missing, 0);

  db.close();
});
