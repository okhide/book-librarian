// 結合試験: 生成済みのreader_level(実データ)の整合性を検証する。Gemini APIは呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve('data/db/library.db');
const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];

test('実データの全summarized本にreader_levelが設定されている', { skip: !fs.existsSync(DB_PATH) }, () => {
  const db = new Database(DB_PATH, { readonly: true });

  const nullCount = db
    .prepare("SELECT COUNT(*) as n FROM books WHERE status = 'summarized' AND reader_level IS NULL")
    .get().n;
  assert.equal(nullCount, 0);

  const invalidLevels = db
    .prepare(
      `SELECT DISTINCT reader_level FROM books WHERE status = 'summarized' AND reader_level IS NOT NULL`
    )
    .all()
    .filter((r) => !VALID_LEVELS.includes(r.reader_level));
  assert.deepEqual(invalidLevels, []);

  const invalidSources = db
    .prepare(
      `SELECT DISTINCT reader_level_source FROM books WHERE status = 'summarized' AND reader_level_source IS NOT NULL`
    )
    .all()
    .filter((r) => !['rule', 'llm'].includes(r.reader_level_source));
  assert.deepEqual(invalidSources, []);

  db.close();
});

test('reader_levelの分布を記録する（実用書中心の蔵書という前提との整合確認）', { skip: !fs.existsSync(DB_PATH) }, () => {
  const db = new Database(DB_PATH, { readonly: true });
  const dist = db
    .prepare("SELECT reader_level, COUNT(*) as n FROM books WHERE status = 'summarized' GROUP BY reader_level")
    .all();
  console.log('reader_level分布:', dist);

  const byLevel = Object.fromEntries(dist.map((r) => [r.reader_level, r.n]));
  assert.ok(byLevel.beginner > byLevel.advanced, 'beginnerがadvancedより多いという前提が崩れている');

  db.close();
});
