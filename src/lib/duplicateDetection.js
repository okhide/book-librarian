// 全ペアのコサイン類似度から重複・近重複候補を検出する（doc/02_use_cases.md UC10）。
// 2,527冊でも約320万回の内積計算で数秒程度のため、build時の永続化はせず
// 呼び出し時にその都度計算する（vectorSearch.jsのsimilar検索と同じ設計方針）。
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * 全ペアのコサイン類似度（ベクトルは正規化済み前提のため内積のみで良い）を計算し、
 * 閾値以上のペアをスコア降順で返す。
 * @param {Array<{bookId: number, vector: Float32Array}>} embeddings
 * @param {number} [threshold]
 * @returns {Array<{bookIdA: number, bookIdB: number, score: number}>}
 */
export function findDuplicatePairs(embeddings, threshold = 0.95) {
  const pairs = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const score = dot(embeddings[i].vector, embeddings[j].vector);
      if (score >= threshold) {
        pairs.push({ bookIdA: embeddings[i].bookId, bookIdB: embeddings[j].bookId, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  return pairs;
}
