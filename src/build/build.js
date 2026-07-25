#!/usr/bin/env node
// フルビルドを実行し、data/db/library.dbを生成する実行スクリプト。
// 使い方: node src/build/build.js
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { initSchema } from '../lib/schema.js';
import { runFullBuild } from './fullBuild.js';

const DB_PATH = path.resolve('data/db/library.db');
const OUTPUT_DATA_DIR = path.resolve('data/output_data');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
initSchema(db);

console.log(`ビルド開始: ${OUTPUT_DATA_DIR} -> ${DB_PATH}`);
const start = Date.now();
const summary = runFullBuild(db, OUTPUT_DATA_DIR);
const elapsedMs = Date.now() - start;

console.log(`完了 (${elapsedMs}ms): 総数=${summary.total} 成功=${summary.inserted} 失敗=${summary.failed.length}`);
if (summary.failed.length > 0) {
  console.log('失敗したファイル:');
  for (const f of summary.failed) {
    console.log(`  - ${f.file}: ${f.reason}`);
  }
}

db.close();
