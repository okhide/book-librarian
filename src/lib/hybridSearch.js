// キーワード検索(LIKE)とベクトル検索(意味検索)を組み合わせたハイブリッド検索。
//
// 「総ヒット件数」の定義について（ユーザーと確認済みの方針）:
// キーワード一致（字面が含まれる）は明確な二値なので、これを既定の件数とする。
// 意味検索の類似度は連続値で「関連/無関係」を明確に二分できない
// （実測: 無関係な本でもコサイン類似度0.7台に達することがある）。
// そのため vectorHitThreshold というしきい値を導入し、これを超えた
// ベクトルのみヒット（キーワードには一致しない）本も件数に含めるかどうかを
// 設定できるようにする。既定値1.0では、通常のコサイン類似度が1.0に達する
// ことは実質無いため、件数は「キーワード一致のみ」になる。
import { searchByKeyword } from './keywordSearch.js';
import { loadAllEmbeddings, topNBySimilarity } from './vectorSearch.js';
import { embedText, toQueryText } from './embed.js';

export const DEFAULT_VECTOR_HIT_THRESHOLD = 1.0;
const VECTOR_RANK_WEIGHT = 100; // 表示順のランキングにのみ使う重み。件数の判定には使わない。
const VECTOR_CANDIDATE_POOL = 50; // 表示用ランキングの候補に加えるベクトル上位件数

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('@huggingface/transformers').FeatureExtractionPipeline} extractor
 * @param {string} queryText
 * @param {{limit?: number, includeStatuses?: string[], vectorHitThreshold?: number, year?: number, category?: string, topic?: string, level?: string, unreadOnly?: boolean}} [options]
 * @returns {Promise<{totalCount: number, results: Array<{book: object, keywordScore: number, vectorScore: number, matchedByKeyword: boolean, combinedScore: number}>}>}
 */
export async function hybridSearch(db, extractor, queryText, options = {}) {
  const {
    limit = 20,
    includeStatuses = ['summarized'],
    vectorHitThreshold = DEFAULT_VECTOR_HIT_THRESHOLD,
    year,
    category,
    topic,
    level,
    unreadOnly,
  } = options;

  const keywordAll = searchByKeyword(db, queryText, {
    limit: Infinity,
    includeStatuses,
    year,
    category,
    topic,
    level,
    unreadOnly,
  });
  const keywordScoreById = new Map(keywordAll.results.map((r) => [r.book.id, r.score]));

  const queryVector = await embedText(extractor, toQueryText(queryText));
  const embeddings = loadAllEmbeddings(db, { includeStatuses, year, category, topic, level, unreadOnly });
  const vectorRanked = topNBySimilarity(queryVector, embeddings, embeddings.length);
  const vectorScoreById = new Map(vectorRanked.map((r) => [r.bookId, r.score]));

  // --- 件数の算出（doc/03_specification.md方針: キーワード一致を基本とする） ---
  const vectorOnlyHitCount = vectorRanked.filter(
    (r) => r.score >= vectorHitThreshold && !keywordScoreById.has(r.bookId)
  ).length;
  const totalCount = keywordScoreById.size + vectorOnlyHitCount;

  // --- 表示用ランキング（キーワードヒット全件 ＋ ベクトル上位を候補にして合成スコアで並べる） ---
  const candidateIds = new Set([
    ...keywordScoreById.keys(),
    ...vectorRanked.slice(0, VECTOR_CANDIDATE_POOL).map((r) => r.bookId),
  ]);
  const getBookStmt = db.prepare('SELECT * FROM books WHERE id = ?');

  const combined = [...candidateIds].map((bookId) => {
    const keywordScore = keywordScoreById.get(bookId) ?? 0;
    const vectorScore = vectorScoreById.get(bookId) ?? 0;
    return {
      book: getBookStmt.get(bookId),
      keywordScore,
      vectorScore,
      matchedByKeyword: keywordScoreById.has(bookId),
      combinedScore: keywordScore + vectorScore * VECTOR_RANK_WEIGHT,
    };
  });
  combined.sort((a, b) => b.combinedScore - a.combinedScore);

  return { totalCount, results: combined.slice(0, limit) };
}
