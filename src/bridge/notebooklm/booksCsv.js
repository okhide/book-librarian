// 元プロジェクトの`book-ask`スキル（~/.claude/skills/book-ask/SKILL.md）が読み込む
// books.csv（UTF-8 BOM付き、列: ソース名,ソースID,notebook名,notebookID）と
// 互換の行を作る。このフェーズでは接続（実際の書き出し先への統合）までは行わず、
// フォーマットの用意のみ。
const HEADER = ['ソース名', 'ソースID', 'notebook名', 'notebookID'];

/**
 * registerBooksToNotebook/registerBooksの結果からbooks.csv互換の行を作る。
 * statusが'added'のものだけを対象にする（スキップ・エラーは登録されていないため対象外）。
 * @param {{id: string, title: string}} notebook
 * @param {Array<{book: {title: string}, status: string, sourceId?: string}>} results
 * @returns {Array<{ソース名: string, ソースID: string, "notebook名": string, notebookID: string}>}
 */
export function toBooksCsvRows(notebook, results) {
  return results
    .filter((r) => r.status === 'added')
    .map((r) => ({
      ソース名: r.book.title,
      ソースID: r.sourceId ?? '',
      'notebook名': notebook.title,
      notebookID: notebook.id,
    }));
}

function escapeCsvField(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * books.csv互換の行配列をCSVテキスト（UTF-8 BOM付き、ヘッダー付き）に変換する。
 * @param {Array<Record<string, string>>} rows
 */
export function formatBooksCsv(rows) {
  const lines = [HEADER.join(',')];
  for (const row of rows) {
    lines.push(HEADER.map((key) => escapeCsvField(row[key])).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
