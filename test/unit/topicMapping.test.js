// classifyBatchFnを注入してテストする。Gemini APIは呼ばない
// （doc/06_implementation_plan.mdの「外部APIはテストで呼ばない」方針）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkArray, buildMappingPrompt, classifyKeywordBatch, generateTopicMapping } from '../../src/build/topicMapping.js';

const TAXONOMY = {
  topics: [
    { name: '会計・財務', description: '会計、簿記、財務諸表' },
    { name: '語学学習', description: '英語、英会話' },
  ],
};

test('chunkArray: 指定サイズで分割する', () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkArray([], 2), []);
});

test('buildMappingPrompt: 分類表とキーワードがプロンプトに含まれる', () => {
  const prompt = buildMappingPrompt(['会計', '英語'], TAXONOMY);
  assert.match(prompt, /会計・財務/);
  assert.match(prompt, /語学学習/);
  assert.match(prompt, /会計, 英語/);
});

test('classifyKeywordBatch: 分類表にあるトピックはそのまま採用される', async () => {
  const fakeGenerate = async () => ({
    mappings: [
      { keyword: '会計', topic: '会計・財務' },
      { keyword: '英語', topic: '語学学習' },
    ],
  });
  const { mapping, invalidCount } = await classifyKeywordBatch(['会計', '英語'], TAXONOMY, fakeGenerate);
  assert.equal(mapping['会計'], '会計・財務');
  assert.equal(mapping['英語'], '語学学習');
  assert.equal(invalidCount, 0);
});

test('classifyKeywordBatch: LLMが応答から省略/書き換えた入力キーワードもnullで補完される', async () => {
  // 実データで実際に発生した挙動: LLMが一部のキーワードを応答に含めない、
  // または表記を変えて返すことがある。元の入力文字列が必ずmappingに残ることを保証する。
  const fakeGenerate = async () => ({
    mappings: [
      { keyword: '会計', topic: '会計・財務' },
      // '英語' は応答から省略された、あるいは書き換えられて返ってきた想定
    ],
  });
  const { mapping, invalidCount } = await classifyKeywordBatch(['会計', '英語'], TAXONOMY, fakeGenerate);
  assert.equal(mapping['会計'], '会計・財務');
  assert.equal(mapping['英語'], null);
  assert.equal(invalidCount, 1);
});

test('classifyKeywordBatch: 分類表に無いトピックはnullとして検知される', async () => {
  const fakeGenerate = async () => ({
    mappings: [{ keyword: '謎の語', topic: '存在しないトピック' }],
  });
  const { mapping, invalidCount } = await classifyKeywordBatch(['謎の語'], TAXONOMY, fakeGenerate);
  assert.equal(mapping['謎の語'], null);
  assert.equal(invalidCount, 1);
});

test('generateTopicMapping: 全キーワードがバッチ処理され、コールバックが呼ばれる', async () => {
  const keywords = ['会計', '簿記', '英語'];
  const calls = [];
  const classifyBatchFn = async (batch) => {
    calls.push(batch);
    const mapping = {};
    for (const k of batch) mapping[k] = '会計・財務';
    return { mapping, invalidCount: 0 };
  };

  const onBatchCalls = [];
  const { mapping, batchesProcessed } = await generateTopicMapping(keywords, TAXONOMY, {
    batchSize: 2,
    classifyBatchFn,
    onBatchComplete: (m) => onBatchCalls.push({ ...m }),
  });

  assert.equal(batchesProcessed, 2); // [会計,簿記], [英語]
  assert.equal(Object.keys(mapping).length, 3);
  assert.equal(onBatchCalls.length, 2);
  assert.deepEqual(calls, [['会計', '簿記'], ['英語']]);
});

test('generateTopicMapping: 既存の対応表にある語はスキップされる（中断・再開）', async () => {
  const keywords = ['会計', '簿記', '英語'];
  const calls = [];
  const classifyBatchFn = async (batch) => {
    calls.push(batch);
    const mapping = {};
    for (const k of batch) mapping[k] = '会計・財務';
    return { mapping, invalidCount: 0 };
  };

  const { mapping, batchesProcessed } = await generateTopicMapping(keywords, TAXONOMY, {
    batchSize: 10,
    classifyBatchFn,
    existingMapping: { 会計: '会計・財務' },
  });

  assert.equal(batchesProcessed, 1);
  assert.deepEqual(calls, [['簿記', '英語']]);
  assert.equal(Object.keys(mapping).length, 3);
});
