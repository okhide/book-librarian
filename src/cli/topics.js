#!/usr/bin/env node
// 使い方: node src/cli/topics.js [--json]
// トピック一覧と各トピックの蔵書数を表示する（絞り込みの候補提示に使う）。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { getTopicCounts } from '../lib/stats.js';

const json = process.argv.includes('--json');
const db = new Database(resolveDbPath(), { readonly: true });
const topicCounts = getTopicCounts(db);
db.close();

if (json) {
  console.log(JSON.stringify(topicCounts, null, 2));
} else {
  console.log(`トピック一覧（${topicCounts.length}件、蔵書数の降順）:`);
  for (const { topic, count } of topicCounts) {
    console.log(`  ${topic}: ${count}冊`);
  }
}
