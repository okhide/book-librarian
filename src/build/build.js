#!/usr/bin/env node
// フルビルドを実行し、data/db/library.dbを生成する実行スクリプト。
// 使い方: node src/build/build.js
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { initSchema } from '../lib/schema.js';
import { runFullBuild } from './fullBuild.js';
import { parseCatalogCsv } from './csv.js';
import { reconcileCatalog } from './reconcileCsv.js';

const DB_PATH = path.resolve('data/db/library.db');
const OUTPUT_DATA_DIR = path.resolve('data/output_data');
const CSV_PATH = path.resolve('data/蔵書リスト.csv');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
initSchema(db);

console.log(`ビルド開始: ${OUTPUT_DATA_DIR} -> ${DB_PATH}`);
const start = Date.now();
const buildSummary = runFullBuild(db, OUTPUT_DATA_DIR);
const buildElapsedMs = Date.now() - start;

console.log(
  `output_data取り込み完了 (${buildElapsedMs}ms): 総数=${buildSummary.total} 成功=${buildSummary.inserted} 失敗=${buildSummary.failed.length}`
);
if (buildSummary.failed.length > 0) {
  console.log('失敗したファイル:');
  for (const f of buildSummary.failed) {
    console.log(`  - ${f.file}: ${f.reason}`);
  }
}

const csvRawText = fs.readFileSync(CSV_PATH, 'utf8');
const { rows: csvRows, warnings: csvWarnings } = parseCatalogCsv(csvRawText);
if (csvWarnings.length > 0) {
  console.log('CSVパースの警告:', csvWarnings);
}
const reconcileSummary = reconcileCatalog(db, csvRows);
console.log(
  `蔵書リスト.csv突き合わせ完了: 既存本へのcsv_*記録=${reconcileSummary.matched} 新規pending追加=${reconcileSummary.pendingInserted}`
);

db.close();
