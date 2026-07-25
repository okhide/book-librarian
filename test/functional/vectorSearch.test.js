// 実際の埋め込みモデルをロードするため、unitではなくfunctionalに置く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder } from '../../src/lib/embed.js';
import { searchByText, searchSimilarToBook } from '../../src/lib/vectorSearch.js';
import { getBookByFilePath } from '../../src/build/persist.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

test('意味検索', async (t) => {
  const extractor = await createEmbedder();

  await t.test('searchByText: クエリで意味的に近い本が上位に来る', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    runFullBuild(db, FIXTURES_OUTPUT_DATA);
    await generateMissingEmbeddings(db, extractor);

    const results = await searchByText(db, extractor, '会計を勉強したい', 6);
    assert.ok(results.length > 0);

    const normalBook = getBookByFilePath(db, 'normal_book.md');
    const rank = results.findIndex((r) => r.bookId === normalBook.id);
    assert.equal(rank, 0, '会計の本がクエリに対して1位でない');

    db.close();
  });

  await t.test('searchSimilarToBook: 実データに対して自分自身を除外して返す', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    runFullBuild(db, FIXTURES_OUTPUT_DATA);
    await generateMissingEmbeddings(db, extractor);

    const normalBook = getBookByFilePath(db, 'normal_book.md');
    const results = searchSimilarToBook(db, normalBook.id, 5);
    assert.ok(results.every((r) => r.bookId !== normalBook.id));
    assert.ok(results.length <= 5);

    db.close();
  });
});
