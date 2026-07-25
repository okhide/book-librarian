#!/usr/bin/env node
// 全キーワードのkeyword→topic対応表を生成する。
// 使い方: node src/build/runTopicMapping.js
// 中断した場合、data/topic_mapping.jsonに既にある語はスキップして再開する。
process.loadEnvFile('.env');

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { collectKeywordFrequencies } from './topicVocab.js';
import { classifyKeywordBatch, generateTopicMapping } from './topicMapping.js';
import { generateStructured } from '../lib/gemini.js';
import { resolveDbPath } from '../cli/dbPath.js';

const TAXONOMY_PATH = path.resolve('data/topic_taxonomy.json');
const MAPPING_PATH = path.resolve('data/topic_mapping.json');
const BATCH_SIZE = 150;

const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
const existingMapping = fs.existsSync(MAPPING_PATH) ? JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')) : {};

const db = new Database(resolveDbPath(), { readonly: true });
const keywords = collectKeywordFrequencies(db).map((r) => r.keyword);
db.close();

console.log(`全キーワード: ${keywords.length}語 / 既存対応表: ${Object.keys(existingMapping).length}語`);

const classifyBatchFn = (batch, tax) => classifyKeywordBatch(batch, tax, generateStructured);

let batchCount = 0;
const { mapping, totalInvalid, batchesProcessed } = await generateTopicMapping(keywords, taxonomy, {
  batchSize: BATCH_SIZE,
  classifyBatchFn,
  existingMapping,
  onBatchComplete: (m) => {
    batchCount++;
    fs.writeFileSync(MAPPING_PATH, JSON.stringify(m, null, 2), 'utf8');
    console.log(`バッチ${batchCount}完了 (累計${Object.keys(m).length}語) 保存済み`);
  },
});

console.log(`\n完了: ${batchesProcessed}バッチ処理、対応表は${Object.keys(mapping).length}語、無効なトピック応答=${totalInvalid}件`);
