// generateTaxonomyDraft自体はGemini APIを呼ぶため自動テストの対象外とする
// （doc/06_implementation_plan.md「外部API(Gemini)はテストで呼ばない」方針）。
// 疎通確認はspike/s09_gemini_api.jsで実施済み。ここではプロンプト生成の純粋関数のみ検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaxonomyDraftPrompt } from '../../src/build/topicTaxonomyDraft.js';

test('buildTaxonomyDraftPrompt: キーワードと出現回数がプロンプトに含まれる', () => {
  const prompt = buildTaxonomyDraftPrompt([
    { keyword: '会計', count: 34 },
    { keyword: '英語', count: 20 },
  ]);
  assert.match(prompt, /会計\(34\)/);
  assert.match(prompt, /英語\(20\)/);
  assert.match(prompt, /トピック分類表/);
});

test('buildTaxonomyDraftPrompt: 空配列でもエラーにならない', () => {
  const prompt = buildTaxonomyDraftPrompt([]);
  assert.equal(typeof prompt, 'string');
});
