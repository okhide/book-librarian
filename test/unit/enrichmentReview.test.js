import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import { listEnrichmentCandidates, resolveEnrichmentCandidate, skipEnrichmentCandidate } from '../../src/lib/enrichmentReview.js';

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function insertBookWithCandidate(db, { filePath, title, author = '著者', status = 'not_found', source = 'ndl_title', candidateCount = null, conflictingNdc = null }) {
  const now = '2026-01-01T00:00:00.000Z';
  const result = db
    .prepare(
      "INSERT INTO books (file_path, status, title, author, enrichment_status, updated_at) VALUES (?, 'summarized', ?, ?, ?, ?)"
    )
    .run(filePath, title, author, status, now);
  db.prepare(
    `INSERT INTO enrichment_candidates (file_path, status, source, candidate_count, conflicting_ndc, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(filePath, status, source, candidateCount, conflictingNdc ? JSON.stringify(conflictingNdc) : null, now);
  return result.lastInsertRowid;
}

test('listEnrichmentCandidates: booksと結合して一覧を返す', () => {
  const db = makeDb();
  insertBookWithCandidate(db, { filePath: 'a.md', title: '本A', status: 'not_found' });
  insertBookWithCandidate(db, { filePath: 'b.md', title: '本B', status: 'needs_review', candidateCount: 3, conflictingNdc: ['159', '336'] });

  const rows = listEnrichmentCandidates(db);
  assert.equal(rows.length, 2);
  const b = rows.find((r) => r.title === '本B');
  assert.equal(b.candidate_count, 3);
  assert.deepEqual(JSON.parse(b.conflicting_ndc), ['159', '336']);
  db.close();
});

test('listEnrichmentCandidates: statusで絞り込める', () => {
  const db = makeDb();
  insertBookWithCandidate(db, { filePath: 'a.md', title: '本A', status: 'not_found' });
  insertBookWithCandidate(db, { filePath: 'b.md', title: '本B', status: 'needs_review' });

  const rows = listEnrichmentCandidates(db, { status: 'needs_review' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '本B');
  db.close();
});

test('resolveEnrichmentCandidate: 手動でISBN・NDCを確定し、候補一覧から消える', () => {
  const db = makeDb();
  const bookId = insertBookWithCandidate(db, { filePath: 'a.md', title: '本A', status: 'needs_review' });

  const updated = resolveEnrichmentCandidate(db, bookId, { isbn: '9784000000000', ndc: '159' });
  assert.equal(updated.enriched_isbn, '9784000000000');
  assert.equal(updated.enriched_ndc, '159');
  assert.equal(updated.enriched_source, 'manual');
  assert.equal(updated.enrichment_status, 'matched');

  assert.equal(listEnrichmentCandidates(db).length, 0);
  db.close();
});

test('resolveEnrichmentCandidate: ISBNが分からずNDCだけでも確定できる', () => {
  const db = makeDb();
  const bookId = insertBookWithCandidate(db, { filePath: 'a.md', title: '本A', status: 'needs_review' });

  const updated = resolveEnrichmentCandidate(db, bookId, { ndc: '141.62' });
  assert.equal(updated.enriched_isbn, null);
  assert.equal(updated.enriched_ndc, '141.62');
  assert.equal(updated.enrichment_status, 'matched');
  assert.equal(listEnrichmentCandidates(db).length, 0);
  db.close();
});

test('resolveEnrichmentCandidate: 存在しないidはエラー', () => {
  const db = makeDb();
  assert.throws(() => resolveEnrichmentCandidate(db, 999, { isbn: '123' }), /見つかりません/);
  db.close();
});

test('skipEnrichmentCandidate: enrichment_status=skippedになり候補一覧から消える', () => {
  const db = makeDb();
  const bookId = insertBookWithCandidate(db, { filePath: 'a.md', title: '本A', status: 'not_found' });

  const updated = skipEnrichmentCandidate(db, bookId);
  assert.equal(updated.enrichment_status, 'skipped');
  assert.equal(listEnrichmentCandidates(db).length, 0);
  db.close();
});
