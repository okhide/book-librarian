import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { parseCatalogCsv } from '../../src/build/csv.js';
import { reconcileCatalog } from '../../src/build/reconcileCsv.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');
const FIXTURE_CSV = path.resolve('test/fixtures/蔵書リスト.csv');

function buildDbWithFixtures() {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA); // 6件のsummarized本が入る
  return db;
}

test('output_dataに対応ファイルがある行は既存のbooksにcsv_*列を記録する（新規行は増えない）', () => {
  const db = buildDbWithFixtures();
  const beforeCount = db.prepare('SELECT COUNT(*) as n FROM books').get().n;

  const rawText = fs.readFileSync(FIXTURE_CSV, 'utf8');
  const { rows } = parseCatalogCsv(rawText);
  const summary = reconcileCatalog(db, rows);

  const afterCount = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  assert.equal(afterCount, beforeCount + summary.pendingInserted);

  const normal = db.prepare('SELECT * FROM books WHERE file_path = ?').get('normal_book.md');
  assert.equal(normal.csv_serial, 1);
  assert.equal(normal.csv_filename, 'normal_book.pdf');
  assert.equal(normal.status, 'summarized');

  db.close();
});

test('output_dataに対応ファイルが無い行はstatus=pendingとして新規追加される', () => {
  const db = buildDbWithFixtures();
  const rawText = fs.readFileSync(FIXTURE_CSV, 'utf8');
  const { rows } = parseCatalogCsv(rawText);
  const summary = reconcileCatalog(db, rows);

  // fixture CSVには「未処理本サンプル」と「重複本サンプル」の2つのmdファイル名が
  // output_dataに存在しないため、pendingが2件増える想定
  assert.equal(summary.pendingInserted, 2);

  const pending = db.prepare("SELECT * FROM books WHERE status = 'pending'").all();
  assert.equal(pending.length, 2);

  const titles = pending.map((p) => p.title).sort();
  assert.deepEqual(titles, ['未処理本サンプル', '重複本サンプル']);

  for (const p of pending) {
    assert.equal(p.file_path, null);
    assert.equal(p.title_is_fallback, 1);
    assert.ok(p.drive_url.startsWith('https://drive.google.com'));
  }

  db.close();
});

test('重複ファイル名の突き合わせでは通し番号が最大の行のdrive_urlが採用される', () => {
  const db = buildDbWithFixtures();
  const rawText = fs.readFileSync(FIXTURE_CSV, 'utf8');
  const { rows } = parseCatalogCsv(rawText);
  reconcileCatalog(db, rows);

  const dup = db.prepare("SELECT * FROM books WHERE title = '重複本サンプル'").get();
  assert.equal(dup.csv_serial, 5);
  assert.equal(dup.drive_url, 'https://drive.google.com/file/d/dummy4-new/view');

  db.close();
});
