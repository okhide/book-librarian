// booksテーブルへの絞り込み条件（year/category/topic/level/unreadOnly）は
// keywordSearch.jsとvectorSearch.jsの両方で同じ形を組み立てる必要があるため、
// ここに1箇所だけ実装する（片方だけ直して片方が古いまま、という事故を防ぐ）。

/**
 * @param {{prefix?: string, year?: number, category?: string, topic?: string, level?: string, unreadOnly?: boolean}} options
 *   prefix: SQLのテーブル別名（例: 'b.'）。JOINを使わない側は省略する。
 * @returns {{conditions: string[], params: any[]}}
 */
export function buildBookFilterConditions({ prefix = '', year, category, topic, level, unreadOnly } = {}) {
  const conditions = [];
  const params = [];

  if (year != null) {
    conditions.push(`${prefix}publication_year = ?`);
    params.push(year);
  }
  if (category != null) {
    conditions.push(`${prefix}category_raw = ?`);
    params.push(category);
  }
  if (level != null) {
    conditions.push(`${prefix}reader_level = ?`);
    params.push(level);
  }
  if (topic != null) {
    conditions.push(`${prefix}id IN (SELECT book_id FROM book_topics WHERE topic = ?)`);
    params.push(topic);
  }
  if (unreadOnly) {
    // 未読 = reading_statusが無い、またはstatus='unread'（既読・読書中・中断は除外）
    conditions.push(`${prefix}file_path NOT IN (SELECT file_path FROM reading_status WHERE status != 'unread')`);
  }

  return { conditions, params };
}
