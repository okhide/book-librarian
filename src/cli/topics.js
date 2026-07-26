#!/usr/bin/env node
// 使い方: node src/cli/topics.js [--json]
// トピック一覧と各トピックの蔵書数を表示する（絞り込みの候補提示に使う）。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { parseFlags } from './argParse.js';
import { getTopicCounts } from '../lib/stats.js';

const SPEC = { json: { flag: '--json', type: 'boolean' } };

function main() {
  const { flags } = parseFlags(process.argv.slice(2), SPEC);

  const db = new Database(resolveDbPath(), { readonly: true });
  let topicCounts;
  try {
    topicCounts = getTopicCounts(db);
  } finally {
    db.close();
  }

  if (flags.json) {
    console.log(JSON.stringify(topicCounts, null, 2));
  } else {
    console.log(`トピック一覧（${topicCounts.length}件、蔵書数の降順）:`);
    for (const { topic, count } of topicCounts) {
      console.log(`  ${topic}: ${count}冊`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
