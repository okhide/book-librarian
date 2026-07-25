// 検索・埋め込み用テキストの合成ロジック。差分更新時にも同じロジックで再合成することで、
// search_text / embed_source_hash の整合性を保つ（doc/03_specification.md「差分更新の要件」参照）。

/** キーワード検索用に合成するテキスト。LIKE '%語%' の対象になる。 */
export function buildSearchText({ title, author, keywords, topics, summaryLong, summaryShort }) {
  const parts = [
    title,
    author,
    ...(keywords ?? []),
    ...(topics ?? []),
    summaryLong,
    summaryShort,
  ].filter((v) => v != null && v !== '');
  return parts.join(' ').toLowerCase();
}

/** 埋め込み対象テキスト。summary_shortは含まない（doc/03_specification.md「意味検索」参照）。 */
export function buildEmbedSourceText({ title, author, keywords, topics, summaryLong }) {
  const parts = [
    title,
    author,
    ...(keywords ?? []),
    ...(topics ?? []),
    summaryLong,
  ].filter((v) => v != null && v !== '');
  return parts.join(' ');
}
