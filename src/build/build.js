#!/usr/bin/env node
// DBを構築・更新する実行スクリプト。
// 使い方:
//   node src/build/build.js          初回は自動でフルビルド、2回目以降は差分更新
//   node src/build/build.js --full   常にフルリビルド（reading_statusは保護される）
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { initSchema } from '../lib/schema.js';
import { runDiffUpdate } from './diffUpdate.js';
import { runFullRebuild } from './fullRebuild.js';
import { parseCatalogCsv } from './csv.js';
import { reconcileCatalog } from './reconcileCsv.js';

const DB_PATH = path.resolve('data/db/library.db');
const OUTPUT_DATA_DIR = path.resolve('data/output_data');
const CSV_PATH = path.resolve('data/蔵書リスト.csv');
const forceFullRebuild = process.argv.includes('--full');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
initSchema(db);

const existingCount = db.prepare('SELECT COUNT(*) as n FROM books').get().n;

if (forceFullRebuild || existingCount === 0) {
  console.log(
    forceFullRebuild ? 'フルリビルドを実行します（reading_statusは保護されます）' : '初回ビルドを実行します'
  );
  const { buildSummary, reconcileSummary } = runFullRebuild(db, OUTPUT_DATA_DIR, CSV_PATH);
  console.log(
    `output_data取り込み: 総数=${buildSummary.total} 成功=${buildSummary.inserted} 失敗=${buildSummary.failed.length}`
  );
  if (buildSummary.failed.length > 0) console.log('失敗したファイル:', buildSummary.failed);
  console.log(
    `蔵書リスト.csv突き合わせ: 既存本への記録=${reconcileSummary.matched} 新規pending追加=${reconcileSummary.pendingInserted}`
  );
} else {
  console.log('差分更新を実行します');
  const diffSummary = runDiffUpdate(db, OUTPUT_DATA_DIR);
  console.log(
    `新規=${diffSummary.added} 昇格=${diffSummary.promoted} 更新=${diffSummary.updated} ` +
      `削除=${diffSummary.deleted} スキップ=${diffSummary.skipped} 失敗=${diffSummary.failed.length}`
  );
  if (diffSummary.failed.length > 0) console.log('失敗したファイル:', diffSummary.failed);

  const csvRawText = fs.readFileSync(CSV_PATH, 'utf8');
  const { rows: csvRows, warnings: csvWarnings } = parseCatalogCsv(csvRawText);
  if (csvWarnings.length > 0) console.log('CSVパースの警告:', csvWarnings);
  const reconcileSummary = reconcileCatalog(db, csvRows);
  console.log(
    `蔵書リスト.csv突き合わせ: 既存本への記録=${reconcileSummary.matched} 新規pending追加=${reconcileSummary.pendingInserted}`
  );
}

db.close();
