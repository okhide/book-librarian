import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { getTopicCounts, getReaderLevelCounts, getStatusCounts, getDataIssuesCount, getOverallStats } from '../../src/lib/stats.js';
import { getBookByFilePath } from '../../src/build/persist.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  return db;
}

test('getTopicCounts: 蔵書数の降順でトピック別件数を返す', () => {
  const db = makeDb();
  const b1 = getBookByFilePath(db, 'normal_book.md').id;
  const b2 = getBookByFilePath(db, 'null_fields_book.md').id;
  db.prepare('INSERT INTO book_topics (book_id, topic) VALUES (?, ?)').run(b1, 'A');
  db.prepare('INSERT INTO book_topics (book_id, topic) VALUES (?, ?)').run(b2, 'A');
  db.prepare('INSERT INTO book_topics (book_id, topic) VALUES (?, ?)').run(b1, 'B');

  const counts = getTopicCounts(db);
  assert.deepEqual(counts, [{ topic: 'A', count: 2 }, { topic: 'B', count: 1 }]);
  db.close();
});

test('getReaderLevelCounts/getStatusCounts/getDataIssuesCount: 実行できて妥当な値を返す', () => {
  const db = makeDb();
  const statusCounts = getStatusCounts(db);
  assert.ok(statusCounts.some((r) => r.status === 'summarized' && r.count === 6));

  const levelCounts = getReaderLevelCounts(db);
  assert.ok(levelCounts.length > 0);

  const issues = getDataIssuesCount(db);
  // fixturesにはtitle_is_fallback1件、summary_long_is_fallback1件（重複なし）で計2件
  assert.equal(issues, 2);
  db.close();
});

test('getOverallStats: 全ての集計をまとめて返す', () => {
  const db = makeDb();
  const stats = getOverallStats(db);
  assert.ok('statusCounts' in stats);
  assert.ok('topicCounts' in stats);
  assert.ok('readerLevelCounts' in stats);
  assert.ok('dataIssuesCount' in stats);
  db.close();
});
