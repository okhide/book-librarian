#!/usr/bin/env node
// 使い方:
//   node src/cli/search.js "<検索語>" [--limit N] [--year Y] [--category C]
//                           [--topic T] [--level L] [--vector-threshold T]
//                           [--unread] [--with-summary] [--json] [--data-issues]
//
// --with-summary: 複数冊の要約summary_shortをまとめて取得するモード。
//   件数上限を200件に引き上げ、文字数が上限(既定40,000字)を超えないよう
//   自動的に切る（doc/03_specification.md「複数冊の一括取得」参照）。
//   横断的な統合回答（例:「投資について蔵書は総じて何を言っている？」）を
//   作る際に使う。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { parseFlags } from './argParse.js';
import { createEmbedder } from '../lib/embed.js';
import { hybridSearch } from '../lib/hybridSearch.js';
import { capResultsByCharBudget, DEFAULT_MAX_COUNT } from '../lib/bulkSummary.js';

const SPEC = {
  json: { flag: '--json', type: 'boolean' },
  dataIssues: { flag: '--data-issues', type: 'boolean' },
  withSummary: { flag: '--with-summary', type: 'boolean' },
  limit: { flag: '--limit', type: 'number' },
  year: { flag: '--year', type: 'number' },
  category: { flag: '--category', type: 'string' },
  topic: { flag: '--topic', type: 'string' },
  level: { flag: '--level', type: 'string' },
  unreadOnly: { flag: '--unread', type: 'boolean' },
  vectorHitThreshold: { flag: '--vector-threshold', type: 'number' },
};

function parseArgs(argv) {
  const { flags, positional } = parseFlags(argv, SPEC);
  const args = { limit: 20, json: false, dataIssues: false, withSummary: false, ...flags };
  if (args.withSummary && flags.limit === undefined) args.limit = DEFAULT_MAX_COUNT;
  args.query = positional.join(' ');
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

function printResults(query, totalCount, results, json, truncated) {
  // returnedCountがtotalCountを超えることがある。totalCountはキーワード一致件数のみを
  // 数えるが、resultsには意味検索のみで一致した補足候補も含むため
  // （doc/03_specification.md「ハイブリッド検索」参照）。matchedByKeywordCountで
  // 両者の関係を明示する: returnedCount = matchedByKeywordCount + (意味検索のみの件数)。
  const matchedByKeywordCount = results.filter((r) => r.matchedByKeyword).length;

  if (json) {
    console.log(
      JSON.stringify(
        {
          totalCount,
          returnedCount: results.length,
          matchedByKeywordCount,
          truncated,
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
  if (results.length > totalCount) {
    console.log(`（うちキーワード一致は${matchedByKeywordCount}件。残りは意味検索のみで見つかった補足候補です）`);
  }
  if (truncated) {
    console.log('（件数または文字数の上限により一部の結果は省略されています）');
  }
  results.forEach((r, i) => {
    const tag = r.matchedByKeyword ? '' : ' [意味検索のみ]';
    console.log(`${i + 1}. [${r.book.id}] ${r.book.title} — ${r.book.author ?? '著者不明'}${tag}`);
    console.log(`   ${r.book.summary_short}`);
  });
}

const USAGE =
  '使い方: node src/cli/search.js "<検索語>" [--limit N] [--year Y] [--category C] [--topic T] [--level L] [--unread] [--vector-threshold T] [--json] [--data-issues]';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(resolveDbPath(), { readonly: true });

  try {
    if (args.dataIssues) {
      const rows = db
        .prepare(
          `SELECT id, title, title_is_fallback, summary_long_is_fallback FROM books
           WHERE status = 'summarized' AND (title_is_fallback = 1 OR summary_long_is_fallback = 1)`
        )
        .all();
      printDataIssues(rows, args.json);
      return;
    }

    if (!args.query) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }

    const extractor = await createEmbedder();
    const { totalCount, results } = await hybridSearch(db, extractor, args.query, {
      limit: args.limit,
      year: args.year,
      category: args.category,
      topic: args.topic,
      level: args.level,
      unreadOnly: args.unreadOnly,
      vectorHitThreshold: args.vectorHitThreshold,
    });

    let finalResults = results;
    let truncated = false;
    if (args.withSummary) {
      const capped = capResultsByCharBudget(results);
      finalResults = capped.results;
      truncated = capped.truncated;
    }

    printResults(args.query, totalCount, finalResults, args.json, truncated);
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
