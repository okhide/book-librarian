import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';

test('initSchema: booksにenrichment_status列が作られる', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const columns = db.prepare('PRAGMA table_info(books)').all().map((c) => c.name);
  assert.ok(columns.includes('enrichment_status'));
  assert.ok(columns.includes('enriched_isbn'));
  assert.ok(columns.includes('enriched_ndc'));
  assert.ok(columns.includes('enriched_source'));
  db.close();
});

test('initSchema: enrichment_candidatesテーブルがfile_pathをキーに作られる', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const columns = db.prepare('PRAGMA table_info(enrichment_candidates)').all();
  const byName = Object.fromEntries(columns.map((c) => [c.name, c]));
  assert.ok(byName.file_path);
  assert.equal(byName.file_path.pk, 1);
  assert.ok(byName.status);
  assert.ok(byName.source);
  assert.ok(byName.candidate_count);
  assert.ok(byName.conflicting_ndc);
  assert.ok(byName.created_at);
  db.close();
});

test('initSchema: 既存DB（enrichment_status列が無い旧スキーマ）にも安全に列を追加できる', () => {
  const db = new Database(':memory:');
  // 列追加前の実DBを模したbooksテーブル（既存データ入り。enrichment_status列だけが無い状態）を用意する
  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY,
      file_path TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'summarized',
      title TEXT,
      isbn TEXT,
      reader_level TEXT,
      publication_year INTEGER,
      updated_at TEXT NOT NULL
    )
  `);
  db.prepare('INSERT INTO books (file_path, title, isbn, updated_at) VALUES (?, ?, ?, ?)').run(
    '既存.md',
    '既存の本',
    '9784000000000',
    '2026-01-01T00:00:00.000Z'
  );

  initSchema(db);

  const columns = db.prepare('PRAGMA table_info(books)').all().map((c) => c.name);
  assert.ok(columns.includes('enrichment_status'));

  // 既存データが壊れていないことを確認
  const row = db.prepare('SELECT * FROM books WHERE file_path = ?').get('既存.md');
  assert.equal(row.title, '既存の本');
  assert.equal(row.isbn, '9784000000000');
  assert.equal(row.enrichment_status, null);
  db.close();
});

test('initSchema: 2回実行してもエラーにならない（列が既にある場合はスキップ）', () => {
  const db = new Database(':memory:');
  initSchema(db);
  assert.doesNotThrow(() => initSchema(db));
  db.close();
});

test('enrichment_candidates: 挿入・取得ができる', () => {
  const db = new Database(':memory:');
  initSchema(db);
  db.prepare('INSERT INTO books (file_path, updated_at) VALUES (?, ?)').run('本.md', '2026-07-26T00:00:00.000Z');
  db.prepare(
    'INSERT INTO enrichment_candidates (file_path, status, source, candidate_count, conflicting_ndc, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('本.md', 'needs_review', 'ndl_title', 3, JSON.stringify(['159', '336']), '2026-07-26T00:00:00.000Z');

  const row = db.prepare('SELECT * FROM enrichment_candidates WHERE file_path = ?').get('本.md');
  assert.equal(row.status, 'needs_review');
  assert.deepEqual(JSON.parse(row.conflicting_ndc), ['159', '336']);
  db.close();
});
