#!/usr/bin/env node
// 使い方:
//   node src/cli/search.js "<検索語>" [--limit N] [--year Y] [--category C]
//                           [--vector-threshold T] [--json] [--data-issues]
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { createEmbedder } from '../lib/embed.js';
import { hybridSearch } from '../lib/hybridSearch.js';

function parseArgs(argv) {
  const args = { limit: 20, json: false, dataIssues: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--data-issues') args.dataIssues = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--year') args.year = Number(argv[++i]);
    else if (a === '--category') args.category = argv[++i];
    else if (a === '--vector-threshold') args.vectorHitThreshold = Number(argv[++i]);
    else rest.push(a);
  }
  args.query = rest.join(' ');
  return args;
}

function printDataIssues(rows, json) {
  if (json) {
    console.log(JSON.stringify({ totalCount: rows.length, results: rows }, null, 2));
    return;
  }
  console.log(`要約データに問題がある本: ${rows.length}件`);
  for (const r of rows) {
    const reasons = [];
    if (r.title_is_fallback) reasons.push('タイトル未取得(ファイル名で代替)');
    if (r.summary_long_is_fallback) reasons.push('初期要約が取得失敗(詳細要約で代替)');
    console.log(`  [${r.id}] ${r.title} — ${reasons.join('、')}`);
  }
}

function printResults(query, totalCount, results, json) {
  if (json) {
    console.log(
      JSON.stringify(
        {
          totalCount,
          results: results.map((r) => ({
            id: r.book.id,
            title: r.book.title,
            author: r.book.author,
            summaryShort: r.book.summary_short,
            matchedByKeyword: r.matchedByKeyword,
            combinedScore: r.combinedScore,
          })),
        },
        null,
        2
      )
    );
    return;
  }
  console.log(`"${query}" — ${totalCount}件ヒット（上位${results.length}件を表示）`);
  results.forEach((r, i) => {
    const tag = r.matchedByKeyword ? '' : ' [意味検索のみ]';
    console.log(`${i + 1}. [${r.book.id}] ${r.book.title} — ${r.book.author ?? '著者不明'}${tag}`);
    console.log(`   ${r.book.summary_short}`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(resolveDbPath(), { readonly: true });

  if (args.dataIssues) {
    const rows = db
      .prepare(
        `SELECT id, title, title_is_fallback, summary_long_is_fallback FROM books
         WHERE status = 'summarized' AND (title_is_fallback = 1 OR summary_long_is_fallback = 1)`
      )
      .all();
    printDataIssues(rows, args.json);
    db.close();
    return;
  }

  if (!args.query) {
    console.error(
      '使い方: node src/cli/search.js "<検索語>" [--limit N] [--year Y] [--category C] [--vector-threshold T] [--json] [--data-issues]'
    );
    process.exitCode = 1;
    db.close();
    return;
  }

  const extractor = await createEmbedder();
  const { totalCount, results } = await hybridSearch(db, extractor, args.query, {
    limit: args.limit,
    year: args.year,
    category: args.category,
    vectorHitThreshold: args.vectorHitThreshold,
  });

  printResults(args.query, totalCount, results, args.json);
  db.close();
}

main();
