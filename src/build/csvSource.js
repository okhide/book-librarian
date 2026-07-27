// 蔵書リスト.csvの取得元（元プロジェクト側の実体）を解決し、最新版に同期する。
// 元プロジェクトはCSVを都度「削除して新規作成」するため、ハードリンク/シンボリックリンクでは
// 実体が入れ替わった時点でリンク切れになる。そのためbuild.js実行のたびにコピーし直す。
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SOURCE_PATH = 'C:\\Users\\okada\\src\\20260702_summarize_book_with_gemini\\蔵書リスト.csv';

/** LIBRARIAN_CSV_SOURCE_PATH環境変数で取得元パスを上書きできる。 */
export function resolveCsvSourcePath() {
  return process.env.LIBRARIAN_CSV_SOURCE_PATH
    ? path.resolve(process.env.LIBRARIAN_CSV_SOURCE_PATH)
    : DEFAULT_SOURCE_PATH;
}

/**
 * 取得元CSVをdestPathへ上書きコピーする。取得元が見つからない場合はコピーせず、
 * 警告メッセージを返す（destPathの既存内容はそのまま残す）。
 * @returns {{copied: boolean, warning: string | null}}
 */
export function refreshCatalogCsv(sourcePath, destPath) {
  if (!fs.existsSync(sourcePath)) {
    return { copied: false, warning: `元CSVが見つかりません: ${sourcePath}` };
  }
  fs.copyFileSync(sourcePath, destPath);
  return { copied: true, warning: null };
}
