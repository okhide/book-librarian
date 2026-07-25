// 蔵書全体の統計。topics/statsコマンドおよび将来のギャップ分析(UC8)で使う。

/** @returns {Array<{topic: string, count: number}>} 蔵書数の降順 */
export function getTopicCounts(db) {
  return db
    .prepare(
      `SELECT bt.topic as topic, COUNT(DISTINCT bt.book_id) as count
       FROM book_topics bt
       JOIN books b ON b.id = bt.book_id
       WHERE b.status = 'summarized'
       GROUP BY bt.topic
       ORDER BY count DESC`
    )
    .all();
}

/** @returns {Array<{reader_level: string|null, count: number}>} */
export function getReaderLevelCounts(db) {
  return db
    .prepare(
      `SELECT reader_level, COUNT(*) as count FROM books
       WHERE status = 'summarized'
       GROUP BY reader_level`
    )
    .all();
}

/** @returns {Array<{status: string, count: number}>} */
export function getStatusCounts(db) {
  return db.prepare(`SELECT status, COUNT(*) as count FROM books GROUP BY status`).all();
}

/** @returns {number} title/summary_longのフォールバックが発生している本の数 */
export function getDataIssuesCount(db) {
  return db
    .prepare(
      `SELECT COUNT(*) as n FROM books
       WHERE status = 'summarized' AND (title_is_fallback = 1 OR summary_long_is_fallback = 1)`
    )
    .get().n;
}

/** @returns {object} stats コマンド用の集計一式 */
export function getOverallStats(db) {
  return {
    statusCounts: getStatusCounts(db),
    topicCounts: getTopicCounts(db),
    readerLevelCounts: getReaderLevelCounts(db),
    dataIssuesCount: getDataIssuesCount(db),
  };
}
