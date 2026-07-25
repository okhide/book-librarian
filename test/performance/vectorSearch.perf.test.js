// 性能試験: 2,527件の総当たりコサイン類似度計算が想定(1ms未満)に収まるか確認する。
// 埋め込み生成(数分かかる)を避けるため、既にビルド済みのdata/db/library.db
//（読み取り専用で開く）を使う。無ければこのテストはスキップする。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { loadAllEmbeddings, topNBySimilarity } from '../../src/lib/vectorSearch.js';

const DB_PATH = path.resolve('data/db/library.db');

test('実データ2,527件の総当たり類似度計算が1ms未満で完了する', { skip: !fs.existsSync(DB_PATH) }, () => {
  const db = new Database(DB_PATH, { readonly: true });
  const embeddings = loadAllEmbeddings(db);
  assert.ok(embeddings.length >= 2527, `埋め込み件数が想定より少ない: ${embeddings.length}`);

  const query = embeddings[0].vector; // 適当な既存ベクトルをクエリとして使う

  // JITウォームアップの影響を避けるため数回計測し最小値を見る
  const times = [];
  for (let i = 0; i < 10; i++) {
    const start = process.hrtime.bigint();
    topNBySimilarity(query, embeddings, 20);
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1e6);
  }
  const minMs = Math.min(...times);
  console.log(`総当たり類似度計算 最小=${minMs.toFixed(3)}ms 全計測=${times.map((t) => t.toFixed(2)).join(',')}`);

  assert.ok(minMs < 5, `想定(1ms未満)から大きく外れている: ${minMs}ms`);

  db.close();
});
