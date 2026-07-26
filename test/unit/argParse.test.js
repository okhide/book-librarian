import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags } from '../../src/cli/argParse.js';

const SPEC = {
  limit: { flag: '--limit', type: 'number' },
  json: { flag: '--json', type: 'boolean' },
  category: { flag: '--category', type: 'string' },
  ids: { flag: '--ids', type: 'numberList' },
};

test('parseFlags: 各型のフラグを解釈し、非フラグは位置引数として残る', () => {
  const { flags, positional } = parseFlags(
    ['検索語', '--limit', '5', '--json', '--category', '実用書'],
    SPEC
  );
  assert.equal(flags.limit, 5);
  assert.equal(flags.json, true);
  assert.equal(flags.category, '実用書');
  assert.deepEqual(positional, ['検索語']);
});

test('parseFlags: numberListはカンマ区切りを数値配列に変換する', () => {
  const { flags } = parseFlags(['--ids', '1,2,3'], SPEC);
  assert.deepEqual(flags.ids, [1, 2, 3]);
});

test('parseFlags: 数値フラグに非数値を渡すとエラーを投げる（NaNを黙って通さない）', () => {
  assert.throws(() => parseFlags(['--limit', 'abc'], SPEC), /--limit.*数値/);
});

test('parseFlags: 数値フラグの値が省略される（末尾に付く）とエラーを投げる', () => {
  assert.throws(() => parseFlags(['--limit'], SPEC), /--limit.*値が必要/);
});

test('parseFlags: numberListの要素に非数値が混ざるとエラーを投げる', () => {
  assert.throws(() => parseFlags(['--ids', '1,x,3'], SPEC), /--ids.*数値/);
});

test('parseFlags: booleanフラグは値を消費しない', () => {
  const { flags, positional } = parseFlags(['--json', '検索語'], SPEC);
  assert.equal(flags.json, true);
  assert.deepEqual(positional, ['検索語']);
});
