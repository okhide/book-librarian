#!/usr/bin/env node
// 使い方: node src/cli/stats.js [--json]
// 蔵書全体の統計（トピック分布・レベル分布・状態別件数）。ギャップ分析に使う。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { getOverallStats } from '../lib/stats.js';

const json = process.argv.includes('--json');
const db = new Database(resolveDbPath(), { readonly: true });
const stats = getOverallStats(db);
db.close();

if (json) {
  console.log(JSON.stringify(stats, null, 2));
} else {
  console.log('=== 蔵書統計 ===');
  console.log('状態別:');
  for (const { status, count } of stats.statusCounts) {
    console.log(`  ${status}: ${count}冊`);
  }
  console.log('\n読者レベル別:');
  for (const { reader_level, count } of stats.readerLevelCounts) {
    console.log(`  ${reader_level ?? '未判定'}: ${count}冊`);
  }
  console.log(`\nトピック数: ${stats.topicCounts.length}種類`);
  console.log('上位10トピック:');
  for (const { topic, count } of stats.topicCounts.slice(0, 10)) {
    console.log(`  ${topic}: ${count}冊`);
  }
  console.log(`\n要約データに問題がある本: ${stats.dataIssuesCount}冊`);
}
