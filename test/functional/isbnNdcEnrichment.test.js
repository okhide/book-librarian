import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import { enrichBook, enrichPendingBooks } from '../../src/build/isbnNdcEnrichment.js';

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function insertSummarizedBook(db, { filePath, title, author = '著者', isbn = null }) {
  const now = '2026-01-01T00:00:00.000Z';
  const result = db
    .prepare(
      "INSERT INTO books (file_path, status, title, author, isbn, updated_at) VALUES (?, 'summarized', ?, ?, ?, ?)"
    )
    .run(filePath, title, author, isbn, now);
  return result.lastInsertRowid;
}

test('enrichBook: matchedならbooksとenriched_*が更新され、enrichment_candidatesは作られない', async () => {
  const db = makeDb();
  const bookId = insertSummarizedBook(db, { filePath: 'a.md', title: '書名A', isbn: '9784000000000' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);

  const resolveNdlFn = async () => ({ status: 'matched', isbn: '9784000000000', ndcCodes: ['674.4'], source: 'ndl_isbn' });
  await enrichBook(db, book, { resolveNdlFn, useGoogleBooks: false });

  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  assert.equal(row.enrichment_status, 'matched');
  assert.equal(row.enriched_isbn, '9784000000000');
  assert.equal(row.enriched_ndc, '674.4');
  assert.equal(row.enriched_source, 'ndl_isbn');

  const candidate = db.prepare('SELECT * FROM enrichment_candidates WHERE file_path = ?').get('a.md');
  assert.equal(candidate, undefined);
  db.close();
});

test('enrichBook: not_foundならenrichment_candidatesに記録され、Google Books無効なら試さない', async () => {
  const db = makeDb();
  const bookId = insertSummarizedBook(db, { filePath: 'b.md', title: '書名B' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);

  let googleBooksCalled = false;
  const resolveNdlFn = async () => ({ status: 'not_found', source: 'ndl_title' });
  const resolveGoogleBooksFn = async () => {
    googleBooksCalled = true;
    return { status: 'not_found' };
  };
  await enrichBook(db, book, { resolveNdlFn, resolveGoogleBooksFn, useGoogleBooks: false });

  assert.equal(googleBooksCalled, false);
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  assert.equal(row.enrichment_status, 'not_found');
  const candidate = db.prepare('SELECT * FROM enrichment_candidates WHERE file_path = ?').get('b.md');
  assert.equal(candidate.status, 'not_found');
  db.close();
});

test('enrichBook: NDLがnot_foundでもGoogle Booksが有効ならフォールバックしてmatchedになる', async () => {
  const db = makeDb();
  const bookId = insertSummarizedBook(db, { filePath: 'c.md', title: '書名C' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);

  const resolveNdlFn = async () => ({ status: 'not_found', source: 'ndl_title' });
  const resolveGoogleBooksFn = async () => ({ status: 'matched', isbn: '9784111111111', source: 'google_books' });
  await enrichBook(db, book, { resolveNdlFn, resolveGoogleBooksFn, useGoogleBooks: true });

  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  assert.equal(row.enrichment_status, 'matched');
  assert.equal(row.enriched_isbn, '9784111111111');
  assert.equal(row.enriched_ndc, null); // Google BooksはNDCを提供しない
  assert.equal(row.enriched_source, 'google_books');
  db.close();
});

test('enrichBook: needs_reviewはcandidate_count/conflicting_ndcを記録する', async () => {
  const db = makeDb();
  const bookId = insertSummarizedBook(db, { filePath: 'd.md', title: '書名D' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);

  const resolveNdlFn = async () => ({
    status: 'needs_review',
    source: 'ndl_title',
    candidateCount: 3,
    conflictingNdc: ['159', '336'],
  });
  await enrichBook(db, book, { resolveNdlFn, useGoogleBooks: false });

  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  assert.equal(row.enrichment_status, 'needs_review');

  const candidate = db.prepare('SELECT * FROM enrichment_candidates WHERE file_path = ?').get('d.md');
  assert.equal(candidate.candidate_count, 3);
  assert.deepEqual(JSON.parse(candidate.conflicting_ndc), ['159', '336']);
  db.close();
});

test('enrichBook: 再処理で解決すると古いenrichment_candidates行は消える', async () => {
  const db = makeDb();
  const bookId = insertSummarizedBook(db, { filePath: 'e.md', title: '書名E' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);

  await enrichBook(db, book, { resolveNdlFn: async () => ({ status: 'not_found' }), useGoogleBooks: false });
  assert.ok(db.prepare('SELECT * FROM enrichment_candidates WHERE file_path = ?').get('e.md'));

  await enrichBook(db, book, {
    resolveNdlFn: async () => ({ status: 'matched', isbn: '9784222222222', ndcCodes: [], source: 'ndl_title' }),
    useGoogleBooks: false,
  });
  const candidate = db.prepare('SELECT * FROM enrichment_candidates WHERE file_path = ?').get('e.md');
  assert.equal(candidate, undefined);
  db.close();
});

test('enrichPendingBooks: enrichment_status IS NULLの本だけを対象にする（中断・再開）', async () => {
  const db = makeDb();
  insertSummarizedBook(db, { filePath: 'f.md', title: '書名F' });
  const alreadyDoneId = insertSummarizedBook(db, { filePath: 'g.md', title: '書名G' });
  db.prepare("UPDATE books SET enrichment_status = 'matched' WHERE id = ?").run(alreadyDoneId);

  let callCount = 0;
  const resolveNdlFn = async () => {
    callCount++;
    return { status: 'matched', isbn: '9784333333333', ndcCodes: [], source: 'ndl_title' };
  };
  const summary = await enrichPendingBooks(db, { resolveNdlFn, useGoogleBooks: false });

  assert.equal(callCount, 1); // 既にmatched済みのgは呼ばれない
  assert.equal(summary.total, 1);
  assert.equal(summary.matched, 1);
  db.close();
});

test('enrichPendingBooks: 集計(matched/notFound/needsReview)が正しい', async () => {
  const db = makeDb();
  insertSummarizedBook(db, { filePath: 'h1.md', title: 'H1' });
  insertSummarizedBook(db, { filePath: 'h2.md', title: 'H2' });
  insertSummarizedBook(db, { filePath: 'h3.md', title: 'H3' });

  const results = {
    'H1': { status: 'matched', isbn: '9784444444444', ndcCodes: [], source: 'ndl_title' },
    'H2': { status: 'not_found' },
    'H3': { status: 'needs_review', candidateCount: 2, conflictingNdc: ['1', '2'] },
  };
  const resolveNdlFn = async ({ title }) => results[title];

  const summary = await enrichPendingBooks(db, { resolveNdlFn, useGoogleBooks: false });
  assert.equal(summary.total, 3);
  assert.equal(summary.matched, 1);
  assert.equal(summary.notFound, 1);
  assert.equal(summary.needsReview, 1);
  db.close();
});

test('enrichPendingBooks: limitを指定すると件数を絞れる', async () => {
  const db = makeDb();
  for (const name of ['j1', 'j2', 'j3']) insertSummarizedBook(db, { filePath: `${name}.md`, title: name });

  let callCount = 0;
  const resolveNdlFn = async () => {
    callCount++;
    return { status: 'matched', isbn: '9784666666666', ndcCodes: [], source: 'ndl_title' };
  };
  const summary = await enrichPendingBooks(db, { resolveNdlFn, useGoogleBooks: false, limit: 2 });

  assert.equal(callCount, 2);
  assert.equal(summary.total, 2);
  db.close();
});

test('enrichPendingBooks: onProgressコールバックが呼ばれる', async () => {
  const db = makeDb();
  insertSummarizedBook(db, { filePath: 'i.md', title: 'I' });
  const calls = [];
  await enrichPendingBooks(db, {
    resolveNdlFn: async () => ({ status: 'matched', isbn: '9784555555555', ndcCodes: [], source: 'ndl_title' }),
    useGoogleBooks: false,
    onProgress: (info) => calls.push(info),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].processed, 1);
  assert.equal(calls[0].total, 1);
  db.close();
});
