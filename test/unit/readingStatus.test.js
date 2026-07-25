import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import {
  getReadingStatus,
  setReadingStatus,
  listReadingStatus,
  getFilePathForBookId,
  findDormantBooks,
} from '../../src/lib/readingStatus.js';

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

test('setReadingStatus: 新規記録できる', () => {
  const db = makeDb();
  setReadingStatus(db, 'a.md', { status: 'unread' });
  const row = getReadingStatus(db, 'a.md');
  assert.equal(row.status, 'unread');
  db.close();
});

test('setReadingStatus: status=readingになるとstarted_atが設定される', () => {
  const db = makeDb();
  const row = setReadingStatus(db, 'a.md', { status: 'reading' });
  assert.ok(row.started_at != null);
  assert.equal(row.finished_at, null);
  db.close();
});

test('setReadingStatus: status=finishedになるとfinished_atが設定される', () => {
  const db = makeDb();
  setReadingStatus(db, 'a.md', { status: 'reading' });
  const row = setReadingStatus(db, 'a.md', { status: 'finished', rating: 5, note: '良かった' });
  assert.ok(row.started_at != null);
  assert.ok(row.finished_at != null);
  assert.equal(row.rating, 5);
  assert.equal(row.note, '良かった');
  db.close();
});

test('setReadingStatus: 既存のstarted_atは上書きされない（再読でリセットしない）', () => {
  const db = makeDb();
  const first = setReadingStatus(db, 'a.md', { status: 'reading' });
  const second = setReadingStatus(db, 'a.md', { status: 'finished' });
  assert.equal(second.started_at, first.started_at);
  db.close();
});

test('setReadingStatus: 不明なstatusはエラーになる', () => {
  const db = makeDb();
  assert.throws(() => setReadingStatus(db, 'a.md', { status: 'reading-too-much' }));
  db.close();
});

test('listReadingStatus: statusで絞り込める、booksのtitleと結合される', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO books (file_path, status, title, title_is_fallback, updated_at) VALUES ('a.md', 'summarized', 'Aという本', 0, '2026-01-01')"
  ).run();
  setReadingStatus(db, 'a.md', { status: 'unread' });
  setReadingStatus(db, 'b.md', { status: 'finished' });

  const unread = listReadingStatus(db, { status: 'unread' });
  assert.equal(unread.length, 1);
  assert.equal(unread[0].title, 'Aという本');

  const all = listReadingStatus(db);
  assert.equal(all.length, 2);
  db.close();
});

test('getFilePathForBookId: summarized本はfile_pathを返し、無ければnull', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO books (file_path, status, title, title_is_fallback, updated_at) VALUES ('a.md', 'summarized', 'A', 0, '2026-01-01')"
  ).run();
  const id = db.prepare("SELECT id FROM books WHERE file_path='a.md'").get().id;
  assert.equal(getFilePathForBookId(db, id), 'a.md');
  assert.equal(getFilePathForBookId(db, 999999), null);
  db.close();
});

test('findDormantBooks: 未読本のみを要約日が古い順に返す（既読・読書中は除外）', () => {
  const db = makeDb();
  const insertBook = (filePath, title, summarizedAt) =>
    db
      .prepare(
        "INSERT INTO books (file_path, status, title, title_is_fallback, summarized_at, updated_at) VALUES (?, 'summarized', ?, 0, ?, '2026-01-01')"
      )
      .run(filePath, title, summarizedAt);

  insertBook('old.md', '古い未読本', '2026-01-01');
  insertBook('new.md', '新しい未読本', '2026-06-01');
  insertBook('finished.md', '読了済みの本（古いが除外される）', '2025-01-01');
  setReadingStatus(db, 'finished.md', { status: 'finished' });

  const dormant = findDormantBooks(db, { limit: 10 });
  assert.deepEqual(
    dormant.map((r) => r.title),
    ['古い未読本', '新しい未読本']
  );
  db.close();
});

test('findDormantBooks: limitで件数を制限できる', () => {
  const db = makeDb();
  for (let i = 0; i < 5; i++) {
    db.prepare(
      "INSERT INTO books (file_path, status, title, title_is_fallback, summarized_at, updated_at) VALUES (?, 'summarized', ?, 0, ?, '2026-01-01')"
    ).run(`b${i}.md`, `本${i}`, `2026-01-0${i + 1}`);
  }
  const dormant = findDormantBooks(db, { limit: 2 });
  assert.equal(dormant.length, 2);
});
