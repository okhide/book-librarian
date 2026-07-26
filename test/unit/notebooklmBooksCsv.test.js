import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBooksCsvRows, formatBooksCsv } from '../../src/bridge/notebooklm/booksCsv.js';

const notebook = { id: 'nb1', title: '蔵書ライブラリ: 会計' };

test('toBooksCsvRows: statusが added の結果だけを行に変換する', () => {
  const results = [
    { book: { title: '本A' }, status: 'added', sourceId: 'src1' },
    { book: { title: '本B' }, status: 'skipped', reason: '既に登録済み' },
    { book: { title: '本C' }, status: 'error', reason: '失敗' },
  ];
  const rows = toBooksCsvRows(notebook, results);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    ソース名: '本A',
    ソースID: 'src1',
    'notebook名': '蔵書ライブラリ: 会計',
    notebookID: 'nb1',
  });
});

test('formatBooksCsv: book-ask互換のヘッダー・UTF-8 BOM・CRLFで出力する', () => {
  const rows = [{ ソース名: '本A', ソースID: 'src1', 'notebook名': '蔵書ライブラリ: 会計', notebookID: 'nb1' }];
  const csv = formatBooksCsv(rows);
  assert.equal(csv.charCodeAt(0), 0xfeff); // BOM
  const withoutBom = csv.slice(1);
  const lines = withoutBom.split('\r\n');
  assert.equal(lines[0], 'ソース名,ソースID,notebook名,notebookID');
  assert.equal(lines[1], '本A,src1,蔵書ライブラリ: 会計,nb1');
});

test('formatBooksCsv: カンマ・改行・ダブルクォートを含む値はエスケープされる', () => {
  const rows = [{ ソース名: '本,タイトル"引用"付き', ソースID: 's1', 'notebook名': 'nb', notebookID: 'id1' }];
  const csv = formatBooksCsv(rows);
  assert.match(csv, /"本,タイトル""引用""付き"/);
});

test('formatBooksCsv: 空配列でもヘッダー行のみ出力される', () => {
  const csv = formatBooksCsv([]);
  const withoutBom = csv.slice(1);
  assert.equal(withoutBom, 'ソース名,ソースID,notebook名,notebookID\r\n');
});
