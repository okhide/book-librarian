#!/usr/bin/env node
// DBを構築・更新する実行スクリプト。
// 使い方:
//   node src/build/build.js          初回は自動でフルビルド、2回目以降は差分更新
//   node src/build/build.js --full   常にフルリビルド（reading_statusは保護される）
process.loadEnvFile?.('.env'); // Google Books補完（GOOGLE_BOOKS_API_KEY）等で使用
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
import { applyReaderLevelRules } from './readerLevel.js';
import { enrichPendingBooks } from './isbnNdcEnrichment.js';
import { isGoogleBooksEnabled } from '../lib/googleBooks.js';
import { findOrphanedReadingStatus } from '../lib/readingStatus.js';
import { resolveDbPath } from '../cli/dbPath.js';
import { resolveCsvSourcePath, refreshCatalogCsv } from './csvSource.js';

const DB_PATH = resolveDbPath();
const OUTPUT_DATA_DIR = path.resolve('data/output_data');
const CSV_PATH = path.resolve('data/蔵書リスト.csv');
const TAXONOMY_PATH = path.resolve('data/topic_taxonomy.json');
const MAPPING_PATH = path.resolve('data/topic_mapping.json');
const OVERRIDES_PATH = path.resolve('data/topic_overrides.json');
const forceFullRebuild = process.argv.includes('--full');

const csvRefresh = refreshCatalogCsv(resolveCsvSourcePath(), CSV_PATH);
if (csvRefresh.copied) {
  console.log('蔵書リスト.csvを元プロジェクトの最新版に同期しました');
} else {
  console.log(`⚠ ${csvRefresh.warning}`);
  console.log('  → data/蔵書リスト.csvは更新されず、既存の内容のまま処理を続行します。');
}

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

const levelSummary = applyReaderLevelRules(db);
console.log(
  `reader_levelルール判定: 対象=${levelSummary.checked}件 更新=${levelSummary.updated}件 (beginner=${levelSummary.beginnerCount} advanced=${levelSummary.advancedCount})`
);

const unclassifiedCount = db
  .prepare("SELECT COUNT(*) as n FROM books WHERE status = 'summarized' AND reader_level IS NULL")
  .get().n;
if (unclassifiedCount > 0) {
  console.log(
    `\n⚠ reader_level未判定の本が${unclassifiedCount}件あります。` +
      `node src/build/runReaderLevelLlm.js を実行してLLM補完してください` +
      `（フルリビルド直後は正常な状態です。ルールで判定できない本の分だけ発生します）。`
  );
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

const useGoogleBooks = isGoogleBooksEnabled();
console.log(`\nISBN・NDC補完を実行します（NDLサーチ${useGoogleBooks ? '＋Google Books補完' : '。Google Books補完は無効'}）...`);
const enrichStart = Date.now();
const enrichSummary = await enrichPendingBooks(db, { useGoogleBooks, delayMs: 250 });
console.log(
  `ISBN・NDC補完: 対象${enrichSummary.total}件中 matched=${enrichSummary.matched} not_found=${enrichSummary.notFound} ` +
    `needs_review=${enrichSummary.needsReview} (${Date.now() - enrichStart}ms)`
);
if (enrichSummary.notFound + enrichSummary.needsReview > 0) {
  console.log(
    `  → ${enrichSummary.notFound + enrichSummary.needsReview}件がレビュー待ちです。node src/cli/enrich.js review で確認できます。`
  );
}

const orphaned = findOrphanedReadingStatus(db);
if (orphaned.length > 0) {
  console.log(
    `\n⚠ 警告: reading_statusのうち${orphaned.length}件が、対応するbooks行を見つけられません` +
      `（ファイル名変更等の可能性）。データは削除していません。対象のfile_path:`
  );
  for (const r of orphaned) console.log(`  - ${r.file_path} (status=${r.status})`);
}

db.close();
