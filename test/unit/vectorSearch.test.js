import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import { floatArrayToBlob } from '../../src/lib/vectorBlob.js';
import { loadAllEmbeddings, topNBySimilarity, searchSimilarToBook } from '../../src/lib/vectorSearch.js';

test('topNBySimilarity: 内積(コサイン類似度)が高い順に上位N件を返す', () => {
  const query = new Float32Array([1, 0, 0]);
  const embeddings = [
    { bookId: 1, vector: new Float32Array([1, 0, 0]) }, // 完全一致 score=1
    { bookId: 2, vector: new Float32Array([0, 1, 0]) }, // 直交 score=0
    { bookId: 3, vector: new Float32Array([0.9, 0.1, 0]) }, // ほぼ一致
  ];

  const top = topNBySimilarity(query, embeddings, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].bookId, 1);
  assert.equal(top[1].bookId, 3);
  assert.ok(top[0].score > top[1].score);
});

test('topNBySimilarity: topNが件数より多い場合は全件返す', () => {
  const query = new Float32Array([1, 0]);
  const embeddings = [{ bookId: 1, vector: new Float32Array([1, 0]) }];
  const top = topNBySimilarity(query, embeddings, 10);
  assert.equal(top.length, 1);
});

function makeDbWithEmbeddings(vectors) {
  const db = new Database(':memory:');
  initSchema(db);
  const insertBook = db.prepare(
    "INSERT INTO books (id, status, title, updated_at) VALUES (?, 'summarized', ?, '2026-01-01')"
  );
  const insertEmbedding = db.prepare(
    'INSERT INTO book_embeddings (book_id, embedding, dim, model) VALUES (?, ?, ?, ?)'
  );
  for (const [bookId, vec] of Object.entries(vectors)) {
    insertBook.run(Number(bookId), `book${bookId}`);
    insertEmbedding.run(Number(bookId), floatArrayToBlob(vec), vec.length, 'test-model');
  }
  return db;
}

test('loadAllEmbeddings: book_embeddingsの全行をFloat32Arrayとして読み込める', () => {
  const db = makeDbWithEmbeddings({
    1: new Float32Array([1, 0, 0]),
    2: new Float32Array([0, 1, 0]),
  });
  const embeddings = loadAllEmbeddings(db);
  assert.equal(embeddings.length, 2);
  const byId = new Map(embeddings.map((e) => [e.bookId, e.vector]));
  assert.deepEqual(Array.from(byId.get(1)), [1, 0, 0]);
  db.close();
});

test('searchSimilarToBook: 自分自身は結果から除外される', () => {
  const db = makeDbWithEmbeddings({
    1: new Float32Array([1, 0, 0]),
    2: new Float32Array([0.99, 0.01, 0]),
    3: new Float32Array([0, 1, 0]),
  });
  const results = searchSimilarToBook(db, 1, 10);
  assert.ok(results.every((r) => r.bookId !== 1));
  assert.equal(results[0].bookId, 2); // 1に最も近いのは2
  db.close();
});

test('searchSimilarToBook: 埋め込みが無い本にはnullを返す', () => {
  const db = makeDbWithEmbeddings({ 1: new Float32Array([1, 0, 0]) });
  const result = searchSimilarToBook(db, 999, 10);
  assert.equal(result, null);
  db.close();
});
