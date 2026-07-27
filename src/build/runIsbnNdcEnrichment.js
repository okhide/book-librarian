#!/usr/bin/env node
// ISBN・NDC分類の外部API補完（NDLサーチ優先、Google Booksはオプション補完）。
// 使い方: node src/build/runIsbnNdcEnrichment.js [--limit N]
// 中断した場合、enrichment_statusがNULLの本のみを対象にするため、
// 再実行すれば未処理分から自動的に続行される。
process.loadEnvFile?.('.env');

import Database from 'better-sqlite3';
import { initSchema } from '../lib/schema.js';
import { enrichPendingBooks } from './isbnNdcEnrichment.js';
import { isGoogleBooksEnabled } from '../lib/googleBooks.js';
import { resolveDbPath } from '../cli/dbPath.js';

const REQUEST_INTERVAL_MS = 250;

const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex !== -1 ? Number(process.argv[limitIndex + 1]) : undefined;

const db = new Database(resolveDbPath());
initSchema(db);

const useGoogleBooks = isGoogleBooksEnabled();
console.log(`Google Books補完: ${useGoogleBooks ? '有効' : '無効（キー未設定またはENRICHMENT_GOOGLE_BOOKS_ENABLED=false）'}`);

if (limit) console.log(`--limit ${limit} が指定されたため、最大${limit}件のみ処理します`);

let processed = 0;
const summary = await enrichPendingBooks(db, {
  useGoogleBooks,
  delayMs: REQUEST_INTERVAL_MS,
  limit,
  onProgress: ({ total, book, result }) => {
    processed++;
    if (processed % 20 === 0 || processed === total) {
      console.log(`進捗 ${processed}/${total}（直近: 「${book.title}」→ ${result.status}）`);
    }
  },
});

console.log(
  `\n完了: 対象${summary.total}件中 matched=${summary.matched} not_found=${summary.notFound} needs_review=${summary.needsReview}`
);
db.close();
