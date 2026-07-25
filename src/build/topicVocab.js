// keywordsのユニーク語彙とその出現頻度を集計する。LLM呼び出しは行わない。
// doc/03_specification.md「正規化メタデータ抽出」の実測根拠（ユニーク8,780語、
// 総出現12,656件、1回のみの語が81%）を再現・検証するための土台。

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{keyword: string, count: number}>} countの降順、同数はkeyword昇順
 */
export function collectKeywordFrequencies(db) {
  return db
    .prepare(
      `SELECT bk.keyword as keyword, COUNT(*) as count
       FROM book_keywords bk
       JOIN books b ON b.id = bk.book_id
       WHERE b.status = 'summarized'
       GROUP BY bk.keyword
       ORDER BY count DESC, bk.keyword ASC`
    )
    .all();
}

/** @returns {Array<{keyword: string, count: number}>} count >= minCount の語のみ */
export function frequentKeywords(db, minCount) {
  return collectKeywordFrequencies(db).filter((r) => r.count >= minCount);
}

/** 集計の概要統計（辞書設計の前提が実データと合っているかの確認用）。 */
export function summarizeFrequencies(frequencies) {
  const uniqueCount = frequencies.length;
  const totalInstances = frequencies.reduce((sum, r) => sum + r.count, 0);
  const onceOnlyCount = frequencies.filter((r) => r.count === 1).length;
  const frequentCount5Plus = frequencies.filter((r) => r.count >= 5).length;
  return { uniqueCount, totalInstances, onceOnlyCount, frequentCount5Plus };
}
