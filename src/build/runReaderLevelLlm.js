#!/usr/bin/env node
// ルールベースで判定できなかった本のreader_levelをLLMで補完する。
// 使い方: node src/build/runReaderLevelLlm.js
// 中断した場合、reader_levelがまだNULLの本のみを対象にするため、
// 再実行すれば未処理分から自動的に続行される。
process.loadEnvFile('.env');

import Database from 'better-sqlite3';
import { classifyReaderLevelBatch, generateReaderLevelsForUnclassified } from './readerLevelLlm.js';
import { generateStructured } from '../lib/gemini.js';
import { resolveDbPath } from '../cli/dbPath.js';

const BATCH_SIZE = 100;

const db = new Database(resolveDbPath());

const classifyBatchFn = (batch) => classifyReaderLevelBatch(batch, generateStructured);

let batchCount = 0;
const summary = await generateReaderLevelsForUnclassified(db, {
  batchSize: BATCH_SIZE,
  classifyBatchFn,
  onBatchComplete: ({ processed, totalInvalid }) => {
    batchCount++;
    console.log(`バッチ${batchCount}完了 (累計${processed}件処理、無効応答=${totalInvalid}件)`);
  },
});

console.log(`\n完了: 対象${summary.totalBooks}件を${summary.batchesProcessed}バッチで処理、無効応答=${summary.totalInvalid}件`);
db.close();
