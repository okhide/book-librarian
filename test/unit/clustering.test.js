import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kMeans } from '../../src/lib/clustering.js';

function v(...xs) {
  return new Float32Array(xs);
}

test('kMeans: 明確に分かれた2群を正しく分離する', () => {
  const vectors = [v(0, 0), v(0.1, 0), v(-0.1, 0.1), v(10, 10), v(10.1, 10), v(9.9, 10.1)];
  const { assignments } = kMeans(vectors, 2, { seed: 1 });
  // 最初の3点は同じクラスタ、最後の3点は同じクラスタ（どちらが0/1かは不定なので相対比較）
  assert.equal(assignments[0], assignments[1]);
  assert.equal(assignments[0], assignments[2]);
  assert.equal(assignments[3], assignments[4]);
  assert.equal(assignments[3], assignments[5]);
  assert.notEqual(assignments[0], assignments[3]);
});

test('kMeans: 決定性（同じseedなら同じ結果）', () => {
  const vectors = [v(0, 0), v(0.1, 0), v(5, 5), v(5.1, 5), v(1, 8), v(1.2, 8.1)];
  const run1 = kMeans(vectors, 3, { seed: 7 });
  const run2 = kMeans(vectors, 3, { seed: 7 });
  assert.deepEqual(run1.assignments, run2.assignments);
});

test('kMeans: 全ベクトルがいずれかのクラスタに割り当てられる', () => {
  const vectors = Array.from({ length: 20 }, (_, i) => v(i, i * 2));
  const { assignments } = kMeans(vectors, 4, { seed: 3 });
  assert.equal(assignments.length, 20);
  for (const a of assignments) assert.ok(a >= 0 && a < 4);
});

test('kMeans: クラスタ数がベクトル数を超える場合はエラー', () => {
  const vectors = [v(0, 0), v(1, 1)];
  assert.throws(() => kMeans(vectors, 5), /クラスタ数/);
});
