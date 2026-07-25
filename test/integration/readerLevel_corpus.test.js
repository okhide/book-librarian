// 結合試験: 実データでのreader_levelルールベース判定の判定率を確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { applyReaderLevelRules } from '../../src/build/readerLevel.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');

test('実データでのルールベース判定率を記録する', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);

  const summary = applyReaderLevelRules(db);
  const classifiedRatio = (summary.beginnerCount + summary.advancedCount) / summary.checked;
  console.log(
    `reader_levelルール判定: 総数=${summary.checked} beginner=${summary.beginnerCount} advanced=${summary.advancedCount} 判定率=${(classifiedRatio * 100).toFixed(1)}%`
  );

  // 事前調査の実測値: beginner 537, advanced 9（doc/03_specification.md参照）
  assert.ok(summary.beginnerCount > 450 && summary.beginnerCount < 650, `beginner件数が想定外: ${summary.beginnerCount}`);
  assert.ok(summary.advancedCount > 0 && summary.advancedCount < 50, `advanced件数が想定外: ${summary.advancedCount}`);
  assert.ok(classifiedRatio > 0.15, `判定率が低すぎる: ${(classifiedRatio * 100).toFixed(1)}%`);

  db.close();
});
