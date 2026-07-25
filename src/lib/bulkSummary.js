// 複数冊の要約(summary_short)を一括取得する際の件数・文字数の上限管理。
// doc/03_specification.md「複数冊の一括取得」参照:
// summary_shortは平均164字のため、50冊で約8,200字、200冊で約33,000字。
// 司書AIが横断統合回答を作る際の安全な上限として、既定maxCharsに余裕を持たせている。

export const DEFAULT_MAX_COUNT = 200;
export const DEFAULT_MAX_CHARS = 40000; // 200冊分(約33,000字)に余裕を持たせた上限

/**
 * @param {Array<{book: {summary_short?: string}}>} results hybridSearchの結果配列
 * @param {{maxCount?: number, maxChars?: number}} [options]
 * @returns {{results: Array, totalChars: number, truncated: boolean}}
 */
export function capResultsByCharBudget(results, options = {}) {
  const { maxCount = DEFAULT_MAX_COUNT, maxChars = DEFAULT_MAX_CHARS } = options;

  const capped = [];
  let totalChars = 0;

  for (const r of results) {
    if (capped.length >= maxCount) break;
    const len = (r.book.summary_short ?? '').length;
    if (totalChars + len > maxChars) break;
    capped.push(r);
    totalChars += len;
  }

  return { results: capped, totalChars, truncated: capped.length < results.length };
}
