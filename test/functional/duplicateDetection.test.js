// 意図的に似せたfixtures（near_duplicate_a/b）が実際の埋め込みで検出されることを確認する。
// 専用の小さなfixtureディレクトリを使う（共通のtest/fixtures/output_dataは他の多数の
// テストが件数を厳密に前提にしているため、そちらには追加しない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder } from '../../src/lib/embed.js';
import { getBookByFilePath } from '../../src/build/persist.js';
import { loadAllEmbeddings } from '../../src/lib/vectorSearch.js';
import { findDuplicatePairs } from '../../src/lib/duplicateDetection.js';

const FIXTURES_DIR = path.resolve('test/fixtures/output_data_duplicates');

test('findDuplicatePairs: 意図的に似せたfixturesが実データの埋め込みで検出される', async () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_DIR);
  const extractor = await createEmbedder();
  await generateMissingEmbeddings(db, extractor);

  const idA = getBookByFilePath(db, 'near_duplicate_a.md').id;
  const idB = getBookByFilePath(db, 'near_duplicate_b.md').id;
  const idC = getBookByFilePath(db, 'unrelated_book.md').id;

  const embeddings = loadAllEmbeddings(db);
  const pairs = findDuplicatePairs(embeddings, 0.95);

  const pairKeys = pairs.map((p) => [p.bookIdA, p.bookIdB].sort((a, b) => a - b).join('-'));
  const expectedKey = [idA, idB].sort((a, b) => a - b).join('-');
  assert.ok(pairKeys.includes(expectedKey), `近重複ペア(${expectedKey})が検出されるべき。実際: ${pairKeys}`);

  // 無関係な本(深海生物)はどちらとも重複ペアにならない
  for (const p of pairs) {
    assert.notEqual(p.bookIdA, idC);
    assert.notEqual(p.bookIdB, idC);
  }

  db.close();
});
