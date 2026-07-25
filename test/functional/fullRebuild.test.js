import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullRebuild } from '../../src/build/fullRebuild.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');
const FIXTURE_CSV = path.resolve('test/fixtures/蔵書リスト.csv');

test('フルリビルドはreading_statusのデータを一切消さない', () => {
  const db = new Database(':memory:');
  initSchema(db);

  db.prepare(
    "INSERT INTO reading_status (file_path, status, rating, note, updated_at) VALUES ('normal_book.md', 'finished', 5, 'とても良かった', ?)"
  ).run(new Date().toISOString());

  runFullRebuild(db, FIXTURES_OUTPUT_DATA, FIXTURE_CSV);

  const row = db.prepare('SELECT * FROM reading_status WHERE file_path = ?').get('normal_book.md');
  assert.ok(row != null, 'reading_statusの行が消えている');
  assert.equal(row.status, 'finished');
  assert.equal(row.rating, 5);
  assert.equal(row.note, 'とても良かった');

  db.close();
});

test('フルリビルド後、booksは正しく再構築されている（output_dataの6件＋CSVのみのpending2件）', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const { buildSummary, reconcileSummary } = runFullRebuild(db, FIXTURES_OUTPUT_DATA, FIXTURE_CSV);

  assert.equal(buildSummary.inserted, 6);
  assert.equal(reconcileSummary.pendingInserted, 2);
  const count = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  assert.equal(count, 8);

  db.close();
});

test('2回連続でフルリビルドしても重複行が発生しない（UNIQUE制約に違反しない）', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullRebuild(db, FIXTURES_OUTPUT_DATA, FIXTURE_CSV);
  runFullRebuild(db, FIXTURES_OUTPUT_DATA, FIXTURE_CSV);

  const count = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  assert.equal(count, 8);

  db.close();
});
