import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCatalogCsv, csvFilenameToMdFilename, pickCanonicalRowsByMdFilename } from '../../src/build/csv.js';

const FIXTURE_CSV = path.resolve('test/fixtures/蔵書リスト.csv');

test('BOM付きCSVを正しくパースできる', () => {
  const rawText = fs.readFileSync(FIXTURE_CSV, 'utf8');
  const { rows, warnings } = parseCatalogCsv(rawText);
  assert.equal(warnings.length, 0);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].csvSerial, 1);
  assert.equal(rows[0].csvFilename, 'normal_book.pdf');
  assert.equal(rows[0].driveUrl, 'https://drive.google.com/file/d/dummy1/view');
});

test('JS Date#toString()形式の更新日時をISO文字列に変換できる', () => {
  const rawText = fs.readFileSync(FIXTURE_CSV, 'utf8');
  const { rows } = parseCatalogCsv(rawText);
  assert.match(rows[0].csvUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('csvFilenameToMdFilename: .pdfを.mdに変換する', () => {
  assert.equal(csvFilenameToMdFilename('sample.pdf'), 'sample.md');
  assert.equal(csvFilenameToMdFilename('[音声DL付]book.pdf'), '[音声DL付]book.md');
});

test('同名ファイルが複数行ある場合、通し番号が最大の行が正になる', () => {
  const rawText = fs.readFileSync(FIXTURE_CSV, 'utf8');
  const { rows } = parseCatalogCsv(rawText);
  const canonical = pickCanonicalRowsByMdFilename(rows);
  const dup = canonical.get('重複本サンプル.md');
  assert.equal(dup.csvSerial, 5);
  assert.equal(dup.driveUrl, 'https://drive.google.com/file/d/dummy4-new/view');
  // 重複が1件に畳み込まれ、全体としてはユニークなmdファイル名の数になる
  assert.equal(canonical.size, 4);
});
