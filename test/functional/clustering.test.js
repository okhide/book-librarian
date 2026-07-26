// summarizeClustersを実際の埋め込みで検証する。test/fixtures/output_data（6件の
// summarized本）を使い、他のテストの件数前提に影響しないよう読むだけにする。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder } from '../../src/lib/embed.js';
import { summarizeClusters } from '../../src/lib/clustering.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

async function buildTempDbWithEmbeddings() {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  const extractor = await createEmbedder();
  await generateMissingEmbeddings(db, extractor);
  return db;
}

test('summarizeClusters: 全件がいずれかのクラスタに含まれ、sizeの降順で返る', async () => {
  const db = await buildTempDbWithEmbeddings();
  const summaries = summarizeClusters(db, { k: 2, seed: 1 });

  assert.equal(summaries.length, 2);
  const totalSize = summaries.reduce((s, c) => s + c.size, 0);
  assert.equal(totalSize, 6); // fixturesのsummarized本は6件
  assert.ok(summaries[0].size >= summaries[1].size);
  db.close();
});

test('summarizeClusters: 代表的な本はsampleSize件までで、bookId/titleを持つ', async () => {
  const db = await buildTempDbWithEmbeddings();
  const summaries = summarizeClusters(db, { k: 2, seed: 1, sampleSize: 2 });

  for (const c of summaries) {
    assert.ok(c.representativeBooks.length <= 2);
    for (const b of c.representativeBooks) {
      assert.ok(typeof b.bookId === 'number');
      assert.ok(typeof b.title === 'string');
    }
  }
  db.close();
});

test('summarizeClusters: 決定性（同じseedなら同じ結果）', async () => {
  const db = await buildTempDbWithEmbeddings();
  const run1 = summarizeClusters(db, { k: 2, seed: 5 });
  const run2 = summarizeClusters(db, { k: 2, seed: 5 });
  assert.deepEqual(run1, run2);
  db.close();
});
