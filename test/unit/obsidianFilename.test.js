import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTopic, buildFilename } from '../../src/bridge/obsidian/filename.js';

test('sanitizeTopic: Windows禁止文字を全角文字に置換する', () => {
  assert.equal(sanitizeTopic('何/どう:する?'), '何／どう：する？');
  assert.equal(sanitizeTopic('ジェットエンジン*清掃「まとめ」'), 'ジェットエンジン＊清掃「まとめ」');
});

test('sanitizeTopic: 日本語・記号混じりの語はそのまま通る', () => {
  assert.equal(sanitizeTopic('資本論の労働価値説'), '資本論の労働価値説');
  assert.equal(sanitizeTopic('C++入門'), 'C++入門');
});

test('sanitizeTopic: 末尾の空白・ドットを除去する（Windows制約）', () => {
  assert.equal(sanitizeTopic('  末尾スペース  '), '末尾スペース');
  assert.equal(sanitizeTopic('末尾ドット...'), '末尾ドット');
});

test('sanitizeTopic: Windows予約語にはアンダースコアを前置する', () => {
  assert.equal(sanitizeTopic('CON'), '_CON');
  assert.equal(sanitizeTopic('com3'), '_com3');
});

test('sanitizeTopic: 空文字・空白やドットのみはエラー', () => {
  assert.throws(() => sanitizeTopic(''), /空、または禁止文字のみ/);
  assert.throws(() => sanitizeTopic('   '), /空、または禁止文字のみ/);
  assert.throws(() => sanitizeTopic('...'), /空、または禁止文字のみ/);
});

test('buildFilename: YYYYMMDD＋トピック名の形式で.md拡張子を付ける', () => {
  assert.equal(
    buildFilename({ topic: '資本論の労働価値説', date: '2026-07-26' }),
    '20260726_資本論の労働価値説.md'
  );
});

test('buildFilename: dateを省略すると今日の日付(YYYYMMDD)が使われる', () => {
  const filename = buildFilename({ topic: 'テスト' });
  assert.match(filename, /^\d{8}_テスト\.md$/);
});

test('buildFilename: 決定性（同じ入力なら同じ結果）', () => {
  const a = buildFilename({ topic: '会計', date: '2026-07-26' });
  const b = buildFilename({ topic: '会計', date: '2026-07-26' });
  assert.equal(a, b);
});

test('buildFilename: topic未指定はエラー', () => {
  assert.throws(() => buildFilename({ date: '2026-07-26' }), /topicは必須/);
});

test('buildFilename: date形式が不正な場合はエラー', () => {
  assert.throws(() => buildFilename({ topic: 'テスト', date: '2026/07/26' }), /YYYY-MM-DD形式/);
});
