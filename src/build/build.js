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
import { createEmbedder } from '../lib/embed.js';
import { generateMissingEmbeddings } from './embedBuild.js';
import { applyTopicsToAllBooks } from './applyTopics.js';

const DB_PATH = path.resolve('data/db/library.db');
const OUTPUT_DATA_DIR = path.resolve('data/output_data');
const CSV_PATH = path.resolve('data/蔵書リスト.csv');
const TAXONOMY_PATH = path.resolve('data/topic_taxonomy.json');
const MAPPING_PATH = path.resolve('data/topic_mapping.json');
const OVERRIDES_PATH = path.resolve('data/topic_overrides.json');
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

if (fs.existsSync(TAXONOMY_PATH) && fs.existsSync(MAPPING_PATH)) {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
  const overrides = fs.existsSync(OVERRIDES_PATH) ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')) : {};
  const topicsSummary = applyTopicsToAllBooks(db, { taxonomy, mapping, overrides });
  console.log(
    `topics適用: 辞書バージョン=${topicsSummary.dictVersion.slice(0, 12)}... 再適用対象=${topicsSummary.totalCandidates}件`
  );
} else {
  console.log('topic_taxonomy.json / topic_mapping.json が無いためtopics適用をスキップします');
}

console.log('埋め込みモデルをロード中...');
const embedStart = Date.now();
const extractor = await createEmbedder();
console.log(`ロード完了 (${Date.now() - embedStart}ms)`);

const embedGenStart = Date.now();
const { generated, total } = await generateMissingEmbeddings(db, extractor);
console.log(
  `埋め込み生成: ${generated}/${total}件 (${Date.now() - embedGenStart}ms)`
);

db.close();
