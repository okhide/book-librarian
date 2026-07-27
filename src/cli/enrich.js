#!/usr/bin/env node
// ISBN・NDC補完のレビューキュー操作。
// 使い方:
//   node src/cli/enrich.js review [--status not_found|needs_review] [--json]
//   node src/cli/enrich.js resolve --id <bookId> [--isbn <ISBN>] [--ndc <NDC>]  （isbn/ndcは少なくとも一方）
//   node src/cli/enrich.js skip --id <bookId>
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { parseFlags } from './argParse.js';
import { listEnrichmentCandidates, resolveEnrichmentCandidate, skipEnrichmentCandidate } from '../lib/enrichmentReview.js';

const SPEC = {
  json: { flag: '--json', type: 'boolean' },
  status: { flag: '--status', type: 'string' },
  id: { flag: '--id', type: 'number' },
  isbn: { flag: '--isbn', type: 'string' },
  ndc: { flag: '--ndc', type: 'string' },
};

const USAGE = [
  '使い方:',
  '  node src/cli/enrich.js review [--status not_found|needs_review] [--json]',
  '  node src/cli/enrich.js resolve --id <bookId> --isbn <ISBN> [--ndc <NDC>]',
  '  node src/cli/enrich.js skip --id <bookId>',
].join('\n');

function parseArgs(argv) {
  const { flags, positional } = parseFlags(argv, SPEC);
  const args = { json: false, ...flags };
  args.command = positional[0];
  return args;
}

function runReview(db, args) {
  const rows = listEnrichmentCandidates(db, { status: args.status });
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log('レビュー待ちの本はありません');
    return;
  }
  console.log(`レビュー待ち${args.status ? `（status=${args.status}）` : ''}: ${rows.length}件`);
  for (const r of rows) {
    const extra =
      r.status === 'needs_review'
        ? ` 候補${r.candidate_count}件 矛盾するNDC=${r.conflicting_ndc}`
        : '';
    console.log(`  [${r.book_id}] ${r.title} — ${r.author ?? '著者不明'} (${r.status}, source=${r.source ?? '不明'})${extra}`);
  }
}

function runResolve(db, args) {
  // ISBNが分からずNDCだけ人間が判断できるケースもあるため、id必須・isbn/ndcは少なくとも一方でよい。
  if (args.id == null || (!args.isbn && !args.ndc)) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const row = resolveEnrichmentCandidate(db, args.id, { isbn: args.isbn, ndc: args.ndc });
  if (args.json) console.log(JSON.stringify(row, null, 2));
  else console.log(`確定しました: [${args.id}] ${row.title} — ISBN=${row.enriched_isbn ?? 'なし'} NDC=${row.enriched_ndc ?? 'なし'}`);
}

function runSkip(db, args) {
  if (args.id == null) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const row = skipEnrichmentCandidate(db, args.id);
  if (args.json) console.log(JSON.stringify(row, null, 2));
  else console.log(`対象外にしました: [${args.id}] ${row.title}`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(resolveDbPath());
  try {
    if (args.command === 'review') runReview(db, args);
    else if (args.command === 'resolve') runResolve(db, args);
    else if (args.command === 'skip') runSkip(db, args);
    else {
      console.error(USAGE);
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
