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

/**
 * book_embeddingsを読み込む。論理削除された本もembeddingの行自体は残っている
 * （doc/03_specification.md「削除されたファイルの扱い」参照）ため、既定では
 * booksテーブルと結合してstatus='summarized'のみに絞る。
 * @param {import('better-sqlite3').Database} db
 * @param {{includeStatuses?: string[], year?: number, category?: string, topic?: string, level?: string}} [options]
 * @returns {Array<{bookId: number, vector: Float32Array}>}
 */
export function loadAllEmbeddings(db, options = {}) {
  const { includeStatuses = ['summarized'], year, category, topic, level } = options;
  const placeholders = includeStatuses.map(() => '?').join(',');
  const conditions = [`b.status IN (${placeholders})`];
  const params = [...includeStatuses];
  if (year != null) {
    conditions.push('b.publication_year = ?');
    params.push(year);
  }
  if (category != null) {
    conditions.push('b.category_raw = ?');
    params.push(category);
  }
  if (level != null) {
    conditions.push('b.reader_level = ?');
    params.push(level);
  }
  if (topic != null) {
    conditions.push('b.id IN (SELECT book_id FROM book_topics WHERE topic = ?)');
    params.push(topic);
  }

  return db
    .prepare(
      `SELECT e.book_id as book_id, e.embedding as embedding
       FROM book_embeddings e
       JOIN books b ON b.id = e.book_id
       WHERE ${conditions.join(' AND ')}`
    )
    .all(...params)
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
