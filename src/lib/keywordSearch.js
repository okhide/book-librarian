// SQLの LIKE '%語%' による字面一致検索。doc/03_specification.md「検索方式の選定」の
// 通り、FTS5は日本語で機能しないため採用しない。spike S8の実測（約20ms/クエリ、
// 2,527行11MB）は想定（約100ms）より速く、この規模では十分な性能。
// ランキングの重みは実装時の初期値であり、実データで随時調整してよい
// （doc/03_specification.md「ランキング」に「仕様として固定しない」と明記）。

const WEIGHTS = {
  title: 100,
  keyword: 50, // keywords/topics共通
  summaryShort: 10,
  summaryLong: 5,
  occurrenceBonusPerHit: 1,
  occurrenceBonusMax: 5,
  reliabilityTiebreak: 0.1,
};

function countOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function scoreBook(book, keywords, topics, queryLower) {
  const titleLower = (book.title ?? '').toLowerCase();
  const shortLower = (book.summary_short ?? '').toLowerCase();
  const longLower = (book.summary_long ?? '').toLowerCase();
  const keywordsLower = keywords.map((k) => k.toLowerCase());
  const topicsLower = topics.map((t) => t.toLowerCase());

  let score = 0;
  let occurrences = 0;

  if (titleLower.includes(queryLower)) {
    score += WEIGHTS.title;
    occurrences += countOccurrences(titleLower, queryLower);
  }
  if (keywordsLower.some((k) => k.includes(queryLower)) || topicsLower.some((t) => t.includes(queryLower))) {
    score += WEIGHTS.keyword;
  }
  if (shortLower.includes(queryLower)) {
    score += WEIGHTS.summaryShort;
    occurrences += countOccurrences(shortLower, queryLower);
  }
  if (longLower.includes(queryLower)) {
    score += WEIGHTS.summaryLong;
    occurrences += countOccurrences(longLower, queryLower);
  }

  score += Math.min(occurrences, WEIGHTS.occurrenceBonusMax) * WEIGHTS.occurrenceBonusPerHit;
  score += (book.reliability ?? 0) * WEIGHTS.reliabilityTiebreak;

  return score;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} queryText
 * @param {{limit?: number, includeStatuses?: string[], year?: number, category?: string, topic?: string, level?: string}} [options]
 * @returns {{totalCount: number, results: Array<{book: object, score: number}>}}
 */
export function searchByKeyword(db, queryText, options = {}) {
  const { limit = 50, includeStatuses = ['summarized'], year, category, topic, level } = options;
  const queryLower = queryText.toLowerCase();
  const placeholders = includeStatuses.map(() => '?').join(',');

  const conditions = [`search_text LIKE ?`, `status IN (${placeholders})`];
  const params = [`%${queryLower}%`, ...includeStatuses];
  if (year != null) {
    conditions.push('publication_year = ?');
    params.push(year);
  }
  if (category != null) {
    conditions.push('category_raw = ?');
    params.push(category);
  }
  if (level != null) {
    conditions.push('reader_level = ?');
    params.push(level);
  }
  if (topic != null) {
    conditions.push('id IN (SELECT book_id FROM book_topics WHERE topic = ?)');
    params.push(topic);
  }

  const rows = db.prepare(`SELECT * FROM books WHERE ${conditions.join(' AND ')}`).all(...params);

  // ヒット件数が多いとbook単位のサブクエリがN+1になり遅くなるため、
  // マッチした本のkeywords/topicsを1回のIN句でまとめて取得する
  // （実データで"会計"検索が34件→160件に増えた際に実測で問題化したため修正）。
  const bookIds = rows.map((r) => r.id);
  const keywordsByBook = new Map();
  const topicsByBook = new Map();
  if (bookIds.length > 0) {
    const idPlaceholders = bookIds.map(() => '?').join(',');
    for (const r of db
      .prepare(`SELECT book_id, keyword FROM book_keywords WHERE book_id IN (${idPlaceholders})`)
      .all(...bookIds)) {
      if (!keywordsByBook.has(r.book_id)) keywordsByBook.set(r.book_id, []);
      keywordsByBook.get(r.book_id).push(r.keyword);
    }
    for (const r of db
      .prepare(`SELECT book_id, topic FROM book_topics WHERE book_id IN (${idPlaceholders})`)
      .all(...bookIds)) {
      if (!topicsByBook.has(r.book_id)) topicsByBook.set(r.book_id, []);
      topicsByBook.get(r.book_id).push(r.topic);
    }
  }

  const scored = rows.map((book) => {
    const keywords = keywordsByBook.get(book.id) ?? [];
    const topics = topicsByBook.get(book.id) ?? [];
    return { book, score: scoreBook(book, keywords, topics, queryLower) };
  });

  scored.sort((a, b) => b.score - a.score);

  return { totalCount: scored.length, results: scored.slice(0, limit) };
}
