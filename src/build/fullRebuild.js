// フルリビルド: 導出データ(books/book_keywords/book_topics/book_embeddings)を
// 全て作り直す。reading_status（ユーザー所有の一次データ）には絶対に触れない。
import { DERIVED_TABLES } from '../lib/schema.js';
import { runFullBuild } from './fullBuild.js';
import { parseCatalogCsv } from './csv.js';
import { reconcileCatalog } from './reconcileCsv.js';
import fs from 'node:fs';

/** 導出データテーブルのみを空にする。reading_statusは対象外。 */
export function clearDerivedTables(db) {
  const run = db.transaction(() => {
    for (const table of DERIVED_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });
  run();
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} outputDataDir
 * @param {string} csvPath
 */
export function runFullRebuild(db, outputDataDir, csvPath) {
  clearDerivedTables(db);
  const buildSummary = runFullBuild(db, outputDataDir);

  const csvRawText = fs.readFileSync(csvPath, 'utf8');
  const { rows: csvRows } = parseCatalogCsv(csvRawText);
  const reconcileSummary = reconcileCatalog(db, csvRows);

  return { buildSummary, reconcileSummary };
}
