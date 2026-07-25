// Step 5.3: ユーザーデータ保護の再検証 ⚠
// reading_status（ユーザー所有の一次データ）が、フルリビルド・差分更新・
// 論理削除・ファイル名変更のいずれでも失われないことを実データに近い形で
// 厳重に検証する。ここで失敗する変更は復元不可能なデータ損失につながるため、
// 他のどのテストよりも慎重に扱うこと。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { runFullRebuild } from '../../src/build/fullRebuild.js';
import { runDiffUpdate } from '../../src/build/diffUpdate.js';
import { setReadingStatus, listReadingStatus, findOrphanedReadingStatus } from '../../src/lib/readingStatus.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');
const FIXTURE_CSV = path.resolve('test/fixtures/蔵書リスト.csv');
const TMP_ROOT = path.resolve('test/tmp');

function makeTempDir(name) {
  const dir = path.join(TMP_ROOT, `userdata-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function copyAllFixtures(destDir) {
  for (const f of fs.readdirSync(FIXTURES_OUTPUT_DATA)) {
    fs.copyFileSync(path.join(FIXTURES_OUTPUT_DATA, f), path.join(destDir, f));
  }
}

/** 複数冊・複数状態のreading_statusを実データらしく作り込む。 */
function seedReadingStatus(db) {
  setReadingStatus(db, 'normal_book.md', { status: 'finished', rating: 5, note: '会計の基本がよく分かった良書' });
  setReadingStatus(db, 'null_fields_book.md', { status: 'reading' });
  setReadingStatus(db, 'short_summary_book.md', { status: 'abandoned', note: '途中で挫折' });
  setReadingStatus(db, 'placeholder_summary_book.md', { status: 'unread' });
}

test('フルリビルドを実行しても、複数状態のreading_statusが1件も欠落・変化しない', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  seedReadingStatus(db);

  const before = listReadingStatus(db);
  assert.equal(before.length, 4);

  runFullRebuild(db, FIXTURES_OUTPUT_DATA, FIXTURE_CSV);

  const after = listReadingStatus(db);
  assert.equal(after.length, 4);
  // book_idやtitleはJOIN由来なので除き、reading_status自体のカラムを比較する
  const strip = (rows) =>
    rows
      .map(({ file_path, status, started_at, finished_at, rating, note }) => ({
        file_path,
        status,
        started_at,
        finished_at,
        rating,
        note,
      }))
      .sort((a, b) => a.file_path.localeCompare(b.file_path));
  assert.deepEqual(strip(after), strip(before));

  db.close();
});

test('差分更新（変化なし）を実行しても、reading_statusは一切変化しない', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  seedReadingStatus(db);

  const before = listReadingStatus(db);
  runDiffUpdate(db, FIXTURES_OUTPUT_DATA);
  const after = listReadingStatus(db);

  assert.deepEqual(after, before);
  db.close();
});

test('本が論理削除されても、reading_status行は完全に残る', () => {
  const dir = makeTempDir('deleted');
  copyAllFixtures(dir);

  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, dir);
  seedReadingStatus(db);

  fs.rmSync(path.join(dir, 'normal_book.md'));
  runDiffUpdate(db, dir);

  const book = db.prepare('SELECT * FROM books WHERE file_path = ?').get('normal_book.md');
  assert.equal(book.status, 'deleted'); // 論理削除されたことの確認

  const rs = db.prepare('SELECT * FROM reading_status WHERE file_path = ?').get('normal_book.md');
  assert.ok(rs != null, '論理削除された本のreading_statusが消えている');
  assert.equal(rs.status, 'finished');
  assert.equal(rs.rating, 5);
  assert.equal(rs.note, '会計の基本がよく分かった良書');

  fs.rmSync(dir, { recursive: true, force: true });
  db.close();
});

test('ファイル名変更で対応が切れたreading_status行は、データを保持したまま検知される', () => {
  const dir = makeTempDir('renamed');
  copyAllFixtures(dir);

  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, dir);
  seedReadingStatus(db);

  // ファイル名変更をシミュレート: 元ファイルを消し、別名で同内容のファイルを置く
  const oldPath = path.join(dir, 'normal_book.md');
  const newPath = path.join(dir, 'normal_book_renamed.md');
  fs.renameSync(oldPath, newPath);
  runDiffUpdate(db, dir);

  // 古いfile_pathのreading_statusはデータを保持したまま残っている
  const rs = db.prepare('SELECT * FROM reading_status WHERE file_path = ?').get('normal_book.md');
  assert.ok(rs != null, 'ファイル名変更でreading_statusのデータが失われている');
  assert.equal(rs.rating, 5);

  // findOrphanedReadingStatusで検知できる
  const orphaned = findOrphanedReadingStatus(db);
  assert.ok(orphaned.some((o) => o.file_path === 'normal_book.md'));

  fs.rmSync(dir, { recursive: true, force: true });
  db.close();
});

test('findOrphanedReadingStatus: 対応するbooksが有る限り検知されない', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  seedReadingStatus(db);

  assert.deepEqual(findOrphanedReadingStatus(db), []);
  db.close();
});
