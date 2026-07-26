// 結合試験: 実データでのキーワード語彙集計が、事前調査の実測値
// （doc/03_specification.md「実測したkeywordsの分布」）から想定される傾向を保っているか確認する。
// data/output_dataは元プロジェクト側で件数が増減しうるため、絶対件数は決め打ちしない
// （2026-07-26、2,527冊→2,547冊への増加を機に決め打ちをやめた）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { collectKeywordFrequencies, summarizeFrequencies } from '../../src/build/topicVocab.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');

test('実データのキーワード語彙集計が事前調査の実測傾向と一致する', () => {
  const bookCount = fs.readdirSync(OUTPUT_DATA_DIR).filter((f) => f.endsWith('.md')).length;
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);

  const freq = collectKeywordFrequencies(db);
  const summary = summarizeFrequencies(freq);
  console.log('キーワード語彙集計:', summary, `(${bookCount}冊)`);

  // doc/03_specification.mdの実測値(2,527冊): ユニーク8,780語、総出現12,656件（約5.0語/冊）、
  // 1回のみ7,148語（81%）、5回以上248語。絶対件数ではなく1冊あたりの比率で傾向を確認する。
  assert.ok(summary.uniqueCount > 8000 && summary.uniqueCount < 12000, `ユニーク数が想定外: ${summary.uniqueCount}`);
  const avgInstancesPerBook = summary.totalInstances / bookCount;
  assert.ok(avgInstancesPerBook > 3 && avgInstancesPerBook < 8, `1冊あたりの出現数が想定外: ${avgInstancesPerBook.toFixed(2)}`);
  assert.ok(summary.onceOnlyCount / summary.uniqueCount > 0.75, 'ロングテール前提が崩れている');

  console.log('上位15件:', freq.slice(0, 15));

  db.close();
});
