import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicatePairs } from '../../src/lib/duplicateDetection.js';

// [1,0]と[0,1]は直交(score=0)、[1,0]同士やほぼ同じ向きのベクトルはscore≒1になる
function v(...xs) {
  return new Float32Array(xs);
}

test('findDuplicatePairs: 閾値以上のペアのみをスコア降順で返す', () => {
  const embeddings = [
    { bookId: 1, vector: v(1, 0) },
    { bookId: 2, vector: v(1, 0) }, // 1と完全一致 score=1
    { bookId: 3, vector: v(0, 1) }, // 1・2と直交 score=0
  ];
  const pairs = findDuplicatePairs(embeddings, 0.95);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].bookIdA, pairs[0].bookIdB], [1, 2]);
  assert.ok(Math.abs(pairs[0].score - 1) < 1e-6);
});

test('findDuplicatePairs: 閾値未満のペアは含まれない', () => {
  const embeddings = [
    { bookId: 1, vector: v(1, 0) },
    { bookId: 2, vector: v(0, 1) },
  ];
  const pairs = findDuplicatePairs(embeddings, 0.95);
  assert.equal(pairs.length, 0);
});

test('findDuplicatePairs: 同じ本同士のペア(自己ペア)は生成されない', () => {
  const embeddings = [{ bookId: 1, vector: v(1, 0) }];
  const pairs = findDuplicatePairs(embeddings, 0.5);
  assert.equal(pairs.length, 0);
});

test('findDuplicatePairs: 3件以上でも全ペアを一度だけ評価する（逆順の重複ペアが出ない）', () => {
  const embeddings = [
    { bookId: 1, vector: v(1, 0) },
    { bookId: 2, vector: v(1, 0) },
    { bookId: 3, vector: v(1, 0) },
  ];
  const pairs = findDuplicatePairs(embeddings, 0.95);
  assert.equal(pairs.length, 3); // (1,2) (1,3) (2,3) の3組
  const keys = pairs.map((p) => `${p.bookIdA}-${p.bookIdB}`);
  assert.deepEqual(new Set(keys).size, 3); // 重複なし
});

test('findDuplicatePairs: 既定の閾値は0.95', () => {
  const embeddings = [
    { bookId: 1, vector: v(1, 0) },
    { bookId: 2, vector: v(0.94, Math.sqrt(1 - 0.94 * 0.94)) }, // score=0.94 < 0.95
  ];
  const pairs = findDuplicatePairs(embeddings);
  assert.equal(pairs.length, 0);
});

test('findDuplicatePairs: 決定性（同じ入力なら同じ結果）', () => {
  const embeddings = [
    { bookId: 1, vector: v(1, 0) },
    { bookId: 2, vector: v(1, 0) },
    { bookId: 3, vector: v(0.99, Math.sqrt(1 - 0.99 * 0.99)) },
  ];
  const run1 = findDuplicatePairs(embeddings, 0.9);
  const run2 = findDuplicatePairs(embeddings, 0.9);
  assert.deepEqual(run1, run2);
});
