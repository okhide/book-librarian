// 結合試験: 実データ全冊の埋め込み生成にかかる時間と正しさを確認する。
// 総件数はディレクトリの実スキャン件数と突き合わせる（parse_corpus.test.js参照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder, EMBEDDING_DIM } from '../../src/lib/embed.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');

test('実データ全冊の埋め込みが全件生成できる', async () => {
  const expectedCount = fs.readdirSync(OUTPUT_DATA_DIR).filter((f) => f.endsWith('.md')).length;
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);

  const extractor = await createEmbedder();
  const start = Date.now();
  const { generated, total } = await generateMissingEmbeddings(db, extractor);
  const elapsedMs = Date.now() - start;
  console.log(`埋め込み生成: ${generated}/${total}件, 所要時間=${elapsedMs}ms (${(elapsedMs / total).toFixed(1)}ms/件)`);

  assert.equal(generated, expectedCount);
  assert.equal(total, expectedCount);

  const count = db.prepare('SELECT COUNT(*) as n FROM book_embeddings').get().n;
  assert.equal(count, expectedCount);

  const dims = db.prepare('SELECT DISTINCT dim FROM book_embeddings').all();
  assert.deepEqual(dims, [{ dim: EMBEDDING_DIM }]);

  db.close();
});
