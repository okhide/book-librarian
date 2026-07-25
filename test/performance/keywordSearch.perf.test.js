// 性能試験: 実データ2,527件へのLIKE検索が想定(約100ms)に収まるか確認する。
// spike実測: 約20ms/クエリ。data/db/library.dbが無い場合はスキップする。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { searchByKeyword } from '../../src/lib/keywordSearch.js';

const DB_PATH = path.resolve('data/db/library.db');

test('実データへのLIKE検索が想定(約100ms)に収まる', { skip: !fs.existsSync(DB_PATH) }, () => {
  const db = new Database(DB_PATH, { readonly: true });

  const queries = ['会計', '英語', '投資', 'python', 'ルネサンス'];
  for (const q of queries) {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      searchByKeyword(db, q);
      times.push(Date.now() - start);
    }
    const minMs = Math.min(...times);
    console.log(`"${q}": 最小=${minMs}ms 全計測=${times.join(',')}`);
    assert.ok(minMs < 200, `"${q}"の検索が想定(約100ms)から大きく外れている: ${minMs}ms`);
  }

  db.close();
});
