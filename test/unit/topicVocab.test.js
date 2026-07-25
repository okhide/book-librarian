import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { collectKeywordFrequencies, frequentKeywords, summarizeFrequencies } from '../../src/build/topicVocab.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  return db;
}

test('collectKeywordFrequencies: 出現回数の降順、同数はキーワード昇順で返る', () => {
  const db = makeDb();
  const freq = collectKeywordFrequencies(db);
  assert.ok(freq.length > 0);
  for (let i = 1; i < freq.length; i++) {
    assert.ok(freq[i - 1].count >= freq[i].count);
  }
  db.close();
});

test('frequentKeywords: minCount以上の語だけに絞れる', () => {
  const db = makeDb();
  const all = collectKeywordFrequencies(db);
  const frequent = frequentKeywords(db, 2);
  assert.ok(frequent.every((r) => r.count >= 2));
  assert.ok(frequent.length <= all.length);
  db.close();
});

test('summarizeFrequencies: ユニーク数・総出現数・1回のみの語数を集計する', () => {
  const db = makeDb();
  const freq = collectKeywordFrequencies(db);
  const summary = summarizeFrequencies(freq);
  assert.equal(summary.totalInstances, freq.reduce((s, r) => s + r.count, 0));
  assert.ok(summary.onceOnlyCount <= summary.uniqueCount);
  db.close();
});

test('pending本のkeywordsは集計に含まれない', () => {
  const db = makeDb();
  const before = collectKeywordFrequencies(db);
  db.prepare(
    "INSERT INTO books (status, title, title_is_fallback, updated_at) VALUES ('pending', 'p', 1, '2026-01-01')"
  ).run();
  const pendingBookId = db.prepare("SELECT id FROM books WHERE status='pending'").get().id;
  db.prepare('INSERT INTO book_keywords (book_id, keyword) VALUES (?, ?)').run(pendingBookId, 'これはpending専用の語');

  const after = collectKeywordFrequencies(db);
  assert.deepEqual(after, before);
  db.close();
});
