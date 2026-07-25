import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capResultsByCharBudget } from '../../src/lib/bulkSummary.js';

function makeResults(count, charsPerSummary) {
  return Array.from({ length: count }, (_, i) => ({
    book: { id: i, summary_short: 'あ'.repeat(charsPerSummary) },
  }));
}

test('件数・文字数どちらも上限未満なら全件そのまま返る', () => {
  const results = makeResults(10, 100);
  const capped = capResultsByCharBudget(results, { maxCount: 200, maxChars: 40000 });
  assert.equal(capped.results.length, 10);
  assert.equal(capped.totalChars, 1000);
  assert.equal(capped.truncated, false);
});

test('件数上限で切られる', () => {
  const results = makeResults(300, 10);
  const capped = capResultsByCharBudget(results, { maxCount: 200, maxChars: 1000000 });
  assert.equal(capped.results.length, 200);
  assert.equal(capped.truncated, true);
});

test('文字数上限で切られる', () => {
  const results = makeResults(100, 164); // 平均的なsummary_short長
  const capped = capResultsByCharBudget(results, { maxCount: 1000, maxChars: 8200 }); // 50冊分相当
  assert.ok(capped.results.length <= 50);
  assert.equal(capped.truncated, true);
  assert.ok(capped.totalChars <= 8200);
});

test('既定値(200冊/40000字)で仕様書の想定(200冊≈33,000字)を包含できる', () => {
  const results = makeResults(200, 164);
  const capped = capResultsByCharBudget(results);
  assert.equal(capped.results.length, 200);
  assert.equal(capped.truncated, false);
});
