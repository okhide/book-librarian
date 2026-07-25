// topic_taxonomy.json + topic_mapping.json + topic_overrides.json を適用してbook_topicsを作る。
// 3ファイル合成の内容ハッシュを「辞書バージョン」とし、books.topic_dict_versionと
// 比較することで、辞書が変わった本だけを再適用する（doc/03_specification.md
// 「トピック分類を編集した場合の再処理」参照）。
import { sha256 } from '../lib/hash.js';
import { applyTopicsForBook, getKeywordsForBook } from './persist.js';

/** オブジェクトのキー順に依存しない安定した文字列化（辞書バージョンのハッシュ用）。 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** @returns {string} taxonomy+mapping+overridesを合成した辞書バージョン(sha256) */
export function computeDictVersion(taxonomy, mapping, overrides) {
  return sha256(stableStringify({ taxonomy, mapping, overrides }));
}

/**
 * 1冊のkeywordsから、対応表＋上書き指定を経てtopicsを決定する。
 * overridesがmappingを上書きする。マッチしないキーワード(null)は無視する。
 * @returns {string[]} 重複を除いたtopics（順序は最初に現れたキーワード順）
 */
export function resolveTopicsForKeywords(keywords, mapping, overrides) {
  const topics = [];
  const seen = new Set();
  for (const keyword of keywords) {
    const topic = overrides[keyword] ?? mapping[keyword];
    if (topic && !seen.has(topic)) {
      seen.add(topic);
      topics.push(topic);
    }
  }
  return topics;
}

/**
 * 辞書バージョンが変わった本にだけtopicsを再適用する。
 * @param {import('better-sqlite3').Database} db
 * @param {{taxonomy: object, mapping: Record<string, string|null>, overrides: Record<string, string>}} dict
 * @returns {{dictVersion: string, updated: number, totalCandidates: number}}
 */
export function applyTopicsToAllBooks(db, dict) {
  const { taxonomy, mapping, overrides } = dict;
  const dictVersion = computeDictVersion(taxonomy, mapping, overrides);

  const candidates = db
    .prepare(
      `SELECT id FROM books
       WHERE status = 'summarized' AND (topic_dict_version IS NULL OR topic_dict_version != ?)`
    )
    .all(dictVersion);

  let updated = 0;
  for (const { id } of candidates) {
    const keywords = getKeywordsForBook(db, id);
    const topics = resolveTopicsForKeywords(keywords, mapping, overrides);
    applyTopicsForBook(db, id, topics, dictVersion);
    updated++;
  }

  return { dictVersion, updated, totalCandidates: candidates.length };
}
