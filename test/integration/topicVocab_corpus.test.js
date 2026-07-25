// 結合試験: 実データでのキーワード語彙集計が、事前調査の実測値
// （doc/03_specification.md「実測したkeywordsの分布」）と一致するか確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { collectKeywordFrequencies, summarizeFrequencies } from '../../src/build/topicVocab.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');

test('実データのキーワード語彙集計が事前調査の実測値と一致する', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);

  const freq = collectKeywordFrequencies(db);
  const summary = summarizeFrequencies(freq);
  console.log('キーワード語彙集計:', summary);

  // doc/03_specification.mdの実測値: ユニーク8,780語、総出現12,656件、
  // 1回のみ7,148語（81%）、5回以上248語
  assert.ok(summary.uniqueCount > 8000 && summary.uniqueCount < 9500, `ユニーク数が想定外: ${summary.uniqueCount}`);
  assert.equal(summary.totalInstances, 12656);
  assert.ok(summary.onceOnlyCount / summary.uniqueCount > 0.75, 'ロングテール前提が崩れている');

  console.log('上位15件:', freq.slice(0, 15));

  db.close();
});
