import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCsvSourcePath, refreshCatalogCsv } from '../../src/build/csvSource.js';

const TMP_ROOT = path.resolve('test/tmp');

function tmpPath(name) {
  return path.join(TMP_ROOT, `csvSource-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

test('resolveCsvSourcePath: 環境変数が無ければ既定パスを返す', () => {
  const original = process.env.LIBRARIAN_CSV_SOURCE_PATH;
  delete process.env.LIBRARIAN_CSV_SOURCE_PATH;
  try {
    assert.match(resolveCsvSourcePath(), /蔵書リスト\.csv$/);
  } finally {
    if (original !== undefined) process.env.LIBRARIAN_CSV_SOURCE_PATH = original;
  }
});

test('resolveCsvSourcePath: 環境変数があればそちらを解決して返す', () => {
  const original = process.env.LIBRARIAN_CSV_SOURCE_PATH;
  process.env.LIBRARIAN_CSV_SOURCE_PATH = 'test/fixtures/蔵書リスト.csv';
  try {
    assert.equal(resolveCsvSourcePath(), path.resolve('test/fixtures/蔵書リスト.csv'));
  } finally {
    if (original === undefined) delete process.env.LIBRARIAN_CSV_SOURCE_PATH;
    else process.env.LIBRARIAN_CSV_SOURCE_PATH = original;
  }
});

test('refreshCatalogCsv: 取得元が存在すればdestPathへコピーされる', () => {
  const source = tmpPath('source.csv');
  const dest = tmpPath('dest.csv');
  fs.writeFileSync(source, '通し番号,ファイル名\n1,test.pdf\n', 'utf8');

  const result = refreshCatalogCsv(source, dest);

  assert.equal(result.copied, true);
  assert.equal(result.warning, null);
  assert.equal(fs.readFileSync(dest, 'utf8'), fs.readFileSync(source, 'utf8'));

  fs.rmSync(source, { force: true });
  fs.rmSync(dest, { force: true });
});

test('refreshCatalogCsv: 取得元が存在しなければコピーせず警告を返す（destPathは変更されない）', () => {
  const source = tmpPath('missing-source.csv');
  const dest = tmpPath('dest-untouched.csv');
  fs.writeFileSync(dest, '既存の内容', 'utf8');

  const result = refreshCatalogCsv(source, dest);

  assert.equal(result.copied, false);
  assert.match(result.warning, /元CSVが見つかりません/);
  assert.equal(fs.readFileSync(dest, 'utf8'), '既存の内容');

  fs.rmSync(dest, { force: true });
});
