// book_embeddings全件をメモリに読み込み、総当たりコサイン類似度で上位N件を返す。
// 2,527件×384次元=約3.9MBに過ぎないため、sqlite-vec等の近似最近傍探索は不要
// （doc/03_specification.md「検索方式の選定」参照）。ベクトルは正規化済みなので
// コサイン類似度は内積だけで計算できる。
import { blobToFloatArray } from './vectorBlob.js';
import { embedText, toQueryText } from './embed.js';

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** @returns {Array<{bookId: number, vector: Float32Array}>} */
export function loadAllEmbeddings(db) {
  return db
    .prepare('SELECT book_id, embedding FROM book_embeddings')
    .all()
    .map((row) => ({ bookId: row.book_id, vector: blobToFloatArray(row.embedding) }));
}

/**
 * @param {Float32Array} queryVector 正規化済みベクトル
 * @param {Array<{bookId: number, vector: Float32Array}>} embeddings
 * @param {number} topN
 * @returns {Array<{bookId: number, score: number}>} scoreの降順
 */
export function topNBySimilarity(queryVector, embeddings, topN) {
  const scored = embeddings.map((e) => ({ bookId: e.bookId, score: dot(queryVector, e.vector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * クエリ文字列を埋め込み、意味的に近い本を上位N件返す。
 * @param {import('better-sqlite3').Database} db
 * @param {import('@huggingface/transformers').FeatureExtractionPipeline} extractor
 * @param {string} queryText
 * @param {number} [topN]
 */
export async function searchByText(db, extractor, queryText, topN = 20) {
  const queryVector = await embedText(extractor, toQueryText(queryText));
  const embeddings = loadAllEmbeddings(db);
  return topNBySimilarity(queryVector, embeddings, topN);
}

/**
 * 指定した本と意味的に近い本を上位N件返す（自分自身は除外する）。
 * 既存の埋め込みを再利用するだけなので、埋め込みモデルのロードは不要。
 * @param {import('better-sqlite3').Database} db
 * @param {number} bookId
 * @param {number} [topN]
 * @returns {Array<{bookId: number, score: number}> | null} 対象本に埋め込みが無ければnull
 */
export function searchSimilarToBook(db, bookId, topN = 10) {
  const target = db.prepare('SELECT embedding FROM book_embeddings WHERE book_id = ?').get(bookId);
  if (!target) return null;

  const queryVector = blobToFloatArray(target.embedding);
  const embeddings = loadAllEmbeddings(db).filter((e) => e.bookId !== bookId);
  return topNBySimilarity(queryVector, embeddings, topN);
}
