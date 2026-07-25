// 結合試験: 生成済みのdata/topic_mapping.jsonの整合性を検証する。
// Gemini APIは呼ばない（生成済みファイルの検証のみ）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { collectKeywordFrequencies } from '../../src/build/topicVocab.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');
const TAXONOMY_PATH = path.resolve('data/topic_taxonomy.json');
const MAPPING_PATH = path.resolve('data/topic_mapping.json');

test('topic_mappingが実データの全キーワードをカバーしている', { skip: !fs.existsSync(MAPPING_PATH) }, () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);

  const realKeywords = new Set(collectKeywordFrequencies(db).map((r) => r.keyword));
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));

  const missing = [...realKeywords].filter((k) => !(k in mapping));
  console.log(`対応表に無いキーワード: ${missing.length}件`, missing.slice(0, 10));
  assert.equal(missing.length, 0, '実データのキーワードが対応表でカバーされていない');

  db.close();
});

test('topic_mappingの値は全てtaxonomyに存在するトピック名かnull', { skip: !fs.existsSync(MAPPING_PATH) }, () => {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const validTopics = new Set(taxonomy.topics.map((t) => t.name));
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));

  const invalid = Object.entries(mapping).filter(([, topic]) => topic !== null && !validTopics.has(topic));
  assert.deepEqual(invalid, [], `taxonomyに無いトピック名が含まれている: ${JSON.stringify(invalid)}`);
});

test('未分類(null)の割合は小さい（1%未満）', { skip: !fs.existsSync(MAPPING_PATH) }, () => {
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
  const entries = Object.entries(mapping);
  const nullCount = entries.filter(([, v]) => v === null).length;
  const ratio = nullCount / entries.length;
  console.log(`未分類率: ${nullCount}/${entries.length} (${(ratio * 100).toFixed(2)}%)`);
  assert.ok(ratio < 0.01, `未分類率が想定より高い: ${(ratio * 100).toFixed(2)}%`);
});

test('全25トピックに少なくとも1語は割り当てられている', { skip: !fs.existsSync(MAPPING_PATH) }, () => {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
  const usedTopics = new Set(Object.values(mapping).filter((v) => v !== null));

  const emptyTopics = taxonomy.topics.map((t) => t.name).filter((name) => !usedTopics.has(name));
  assert.deepEqual(emptyTopics, [], `キーワードが1件も割り当てられていないトピックがある: ${emptyTopics}`);
});
