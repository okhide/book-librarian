// 結合試験: 実データ2,527冊の埋め込み生成にかかる時間と正しさを確認する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder, EMBEDDING_DIM } from '../../src/lib/embed.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');

test('実データ2,527冊の埋め込みが全件生成できる', async () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);

  const extractor = await createEmbedder();
  const start = Date.now();
  const { generated, total } = await generateMissingEmbeddings(db, extractor);
  const elapsedMs = Date.now() - start;
  console.log(`埋め込み生成: ${generated}/${total}件, 所要時間=${elapsedMs}ms (${(elapsedMs / total).toFixed(1)}ms/件)`);

  assert.equal(generated, 2527);
  assert.equal(total, 2527);

  const count = db.prepare('SELECT COUNT(*) as n FROM book_embeddings').get().n;
  assert.equal(count, 2527);

  const dims = db.prepare('SELECT DISTINCT dim FROM book_embeddings').all();
  assert.deepEqual(dims, [{ dim: EMBEDDING_DIM }]);

  db.close();
});
