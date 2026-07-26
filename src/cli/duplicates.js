#!/usr/bin/env node
// 使い方: node src/cli/duplicates.js [--threshold 0.95] [--json]
// 全ペアのコサイン類似度から重複・近重複候補（別版・シリーズ本・重複購入等）を検出する。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { parseFlags } from './argParse.js';
import { loadAllEmbeddings } from '../lib/vectorSearch.js';
import { findDuplicatePairs } from '../lib/duplicateDetection.js';

const SPEC = {
  json: { flag: '--json', type: 'boolean' },
  threshold: { flag: '--threshold', type: 'number' },
};

function parseArgs(argv) {
  const { flags } = parseFlags(argv, SPEC);
  return { json: false, threshold: 0.95, ...flags };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(resolveDbPath(), { readonly: true });

  try {
    const embeddings = loadAllEmbeddings(db);
    const pairs = findDuplicatePairs(embeddings, args.threshold);

    const getBook = db.prepare('SELECT title, author FROM books WHERE id = ?');
    const enriched = pairs.map((p) => ({
      bookIdA: p.bookIdA,
      titleA: getBook.get(p.bookIdA)?.title,
      bookIdB: p.bookIdB,
      titleB: getBook.get(p.bookIdB)?.title,
      score: p.score,
    }));

    if (args.json) {
      console.log(JSON.stringify({ threshold: args.threshold, count: enriched.length, pairs: enriched }, null, 2));
    } else {
      console.log(`類似度${args.threshold}以上のペア: ${enriched.length}件`);
      for (const p of enriched) {
        console.log(`  [${p.bookIdA}] ${p.titleA} <-> [${p.bookIdB}] ${p.titleB}  (score=${p.score.toFixed(4)})`);
      }
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
