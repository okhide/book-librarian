#!/usr/bin/env node
// 使い方: node src/cli/stats.js [--json] [--clusters] [--k N]
// 蔵書全体の統計（トピック分布・レベル分布・状態別件数）。ギャップ分析に使う。
// --clustersを付けるとk-meansによる自動クラスタリング（既定k=20）も計算する
// （意味的な塊への分割。あらかじめ決めたtopicsとは異なる「データ自身の構造」）。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { parseFlags } from './argParse.js';
import { getOverallStats } from '../lib/stats.js';
import { summarizeClusters } from '../lib/clustering.js';

const SPEC = {
  json: { flag: '--json', type: 'boolean' },
  clusters: { flag: '--clusters', type: 'boolean' },
  k: { flag: '--k', type: 'number' },
};

function main() {
  const { flags } = parseFlags(process.argv.slice(2), SPEC);
  const k = flags.k ?? 20;

  const db = new Database(resolveDbPath(), { readonly: true });
  let stats, clusters;
  try {
    stats = getOverallStats(db);
    clusters = flags.clusters ? summarizeClusters(db, { k }) : null;
  } finally {
    db.close();
  }

  if (flags.json) {
    console.log(JSON.stringify(clusters ? { ...stats, clusters } : stats, null, 2));
    return;
  }

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

  if (clusters) {
    console.log(`\n=== 自動クラスタリング（k=${k}） ===`);
    for (const c of clusters) {
      const topicsLabel = c.topTopics.map(({ topic, count }) => `${topic}(${count})`).join('、');
      console.log(`クラスタ${c.clusterIndex}（${c.size}件）主なトピック: ${topicsLabel}`);
      for (const b of c.representativeBooks) console.log(`  - ${b.title}`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
