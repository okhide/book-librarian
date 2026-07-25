import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

test('better-sqlite3 でインメモリDBを操作できる', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
  const row = db.prepare('SELECT * FROM t WHERE id = ?').get(1);
  assert.equal(row.v, 'hello');
  db.close();
});

test('LIKE による日本語の部分一致検索ができる', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT)');
  const insert = db.prepare('INSERT INTO books (title) VALUES (?)');
  insert.run('会計の基本');
  insert.run('管理会計入門');
  insert.run('英語入門');

  const hits = db.prepare("SELECT * FROM books WHERE title LIKE '%会計%'").all();
  assert.equal(hits.length, 2);
  db.close();
});
