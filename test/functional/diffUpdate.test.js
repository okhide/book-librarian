import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runDiffUpdate } from '../../src/build/diffUpdate.js';
import { getBookByFilePath, getKeywordsForBook } from '../../src/build/persist.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');
const TMP_ROOT = path.resolve('test/tmp');

function makeTempDir(name) {
  const dir = path.join(TMP_ROOT, `diffUpdate-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function copyFixture(fixtureName, destDir, destName = fixtureName) {
  fs.copyFileSync(path.join(FIXTURES_OUTPUT_DATA, fixtureName), path.join(destDir, destName));
}

test('新規ファイルはaddedとして追加される', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const dir = makeTempDir('added');
  copyFixture('normal_book.md', dir);

  const summary = runDiffUpdate(db, dir);
  assert.equal(summary.added, 1);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 0);

  const book = getBookByFilePath(db, 'normal_book.md');
  assert.ok(book != null);
  assert.equal(book.status, 'summarized');

  fs.rmSync(dir, { recursive: true, force: true });
  db.close();
});

test('冪等性: 変化が無いディレクトリに2回実行しても全てskippedになる', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const dir = makeTempDir('idempotent');
  copyFixture('normal_book.md', dir);
  copyFixture('null_fields_book.md', dir);

  const first = runDiffUpdate(db, dir);
  assert.equal(first.added, 2);

  const second = runDiffUpdate(db, dir);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.deleted, 0);
  assert.equal(second.skipped, 2);

  fs.rmSync(dir, { recursive: true, force: true });
  db.close();
});

test('ファイル内容が変わった場合はupdatedとしてカウントされ、keywordsが入れ替わる', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const dir = makeTempDir('updated');
  const filePath = path.join(dir, 'normal_book.md');
  copyFixture('normal_book.md', dir);

  runDiffUpdate(db, dir);
  const before = getBookByFilePath(db, 'normal_book.md');
  assert.deepEqual(getKeywordsForBook(db, before.id), ['会計', '簿記', '決算', '財務', '経営']);

  // 内容を変更（keywordsを差し替え）し、mtimeも確実に変える
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(
    'keywords: ["会計", "簿記", "決算", "財務", "経営"]',
    'keywords: ["投資", "資産運用"]'
  );
  fs.writeFileSync(filePath, content, 'utf8');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(filePath, future, future);

  const summary = runDiffUpdate(db, dir);
  assert.equal(summary.updated, 1);
  assert.equal(summary.added, 0);

  const after = getBookByFilePath(db, 'normal_book.md');
  assert.equal(after.id, before.id); // 同じ本のUPDATE。新規行ではない
  assert.deepEqual(getKeywordsForBook(db, after.id), ['投資', '資産運用']);

  fs.rmSync(dir, { recursive: true, force: true });
  db.close();
});

test('mtimeだけ変わって内容が同一の場合はskippedになるが、file_mtimeは更新される', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const dir = makeTempDir('touch');
  const filePath = path.join(dir, 'normal_book.md');
  copyFixture('normal_book.md', dir);

  runDiffUpdate(db, dir);
  const before = getBookByFilePath(db, 'normal_book.md');

  const future = new Date(Date.now() + 5000);
  fs.utimesSync(filePath, future, future); // 内容は変えずmtimeだけ変える

  const summary = runDiffUpdate(db, dir);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.updated, 0);

  const after = getBookByFilePath(db, 'normal_book.md');
  assert.notEqual(after.file_mtime, before.file_mtime);
  assert.equal(after.content_hash, before.content_hash);

  fs.rmSync(dir, { recursive: true, force: true });
  db.close();
});

test('ファイルが削除されると論理削除(status=deleted)される。行は残る', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const dir = makeTempDir('deleted');
  const filePath = path.join(dir, 'normal_book.md');
  copyFixture('normal_book.md', dir);

  runDiffUpdate(db, dir);
  fs.rmSync(filePath);

  const summary = runDiffUpdate(db, dir);
  assert.equal(summary.deleted, 1);

  const after = getBookByFilePath(db, 'normal_book.md');
  assert.ok(after != null); // 物理削除はされない
  assert.equal(after.status, 'deleted');

  fs.rmSync(dir, { recursive: true, force: true });
  db.close();
});

test('pending本に対応するファイルが出現するとsummarizedに昇格し、同じ行が更新される', () => {
  const db = new Database(':memory:');
  initSchema(db);
  const dir = makeTempDir('promote');

  db.prepare(
    `INSERT INTO books (status, title, title_is_fallback, csv_filename, csv_serial, updated_at)
     VALUES ('pending', 'テスト用の会計入門book', 1, 'normal_book.pdf', 99, ?)`
  ).run(new Date().toISOString());
  const pendingId = db.prepare("SELECT id FROM books WHERE status='pending'").get().id;

  copyFixture('normal_book.md', dir);
  const summary = runDiffUpdate(db, dir);

  assert.equal(summary.promoted, 1);
  assert.equal(summary.added, 0);

  const promoted = getBookByFilePath(db, 'normal_book.md');
  assert.equal(promoted.id, pendingId); // 新規行ではなく既存pending行が更新された
  assert.equal(promoted.status, 'summarized');
  assert.equal(promoted.csv_serial, 99); // csv系の情報は保持される

  fs.rmSync(dir, { recursive: true, force: true });
  db.close();
});
