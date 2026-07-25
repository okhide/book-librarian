// 実際の埋め込みモデルをロードするため、unitではなくfunctionalに置く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder } from '../../src/lib/embed.js';
import { hybridSearch } from '../../src/lib/hybridSearch.js';
import { searchByKeyword } from '../../src/lib/keywordSearch.js';
import { getBookByFilePath, markDeleted } from '../../src/build/persist.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

async function makeDb(extractor) {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  await generateMissingEmbeddings(db, extractor);
  return db;
}

test('ハイブリッド検索', async (t) => {
  const extractor = await createEmbedder();

  await t.test('既定(threshold=1.0)では総ヒット件数がキーワード一致件数と一致する', async () => {
    const db = await makeDb(extractor);
    const keywordOnly = searchByKeyword(db, '会計', { limit: Infinity });
    const hybrid = await hybridSearch(db, extractor, '会計');
    assert.equal(hybrid.totalCount, keywordOnly.totalCount);
    db.close();
  });

  await t.test('thresholdを下げるとベクトルのみの一致も件数に加算される', async () => {
    const db = await makeDb(extractor);
    const strict = await hybridSearch(db, extractor, '会計', { vectorHitThreshold: 1.0 });
    const loose = await hybridSearch(db, extractor, '会計', { vectorHitThreshold: 0.5 });
    assert.ok(
      loose.totalCount >= strict.totalCount,
      `しきい値を下げても件数が増えていない (strict=${strict.totalCount}, loose=${loose.totalCount})`
    );
    db.close();
  });

  await t.test('キーワード・ベクトル両方に一致する本が上位に来る', async () => {
    const db = await makeDb(extractor);
    const { results } = await hybridSearch(db, extractor, '会計');
    const normalBook = getBookByFilePath(db, 'normal_book.md');
    assert.equal(results[0].book.id, normalBook.id);
    assert.equal(results[0].matchedByKeyword, true);
    db.close();
  });

  await t.test('論理削除された本は件数・結果のどちらからも除外される', async () => {
    const db = await makeDb(extractor);
    const normalBook = getBookByFilePath(db, 'normal_book.md');

    const before = await hybridSearch(db, extractor, '会計');
    assert.ok(before.results.some((r) => r.book.id === normalBook.id));

    markDeleted(db, normalBook.id);

    const after = await hybridSearch(db, extractor, '会計');
    assert.ok(after.results.every((r) => r.book.id !== normalBook.id));
    assert.ok(after.totalCount < before.totalCount);

    db.close();
  });
});
