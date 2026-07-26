// Obsidian Vaultへのノート一覧取得・書き込み（doc/06_implementation_plan.md Phase 8）。
// マージするか別名保存するかの判断・本文の作成自体はChat内でClaudeが行う。
// ここが担うのは「既存ノートの検出」と「決定的な書き込み」のみ。
import fs from 'node:fs';
import path from 'node:path';

/**
 * notesDir配下の.mdファイル一覧を返す。queryを指定するとファイル名の部分一致で絞り込む
 * （既存ノートとの重複候補をChat側で確認させるために使う）。
 * @param {string} notesDir
 * @param {{query?: string}} [options]
 * @returns {string[]} ファイル名（notesDir相対）の配列
 */
export function listNotes(notesDir, { query } = {}) {
  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith('.md'));
  if (!query) return files;
  return files.filter((f) => f.includes(query));
}

/**
 * notesDir配下にノートを書き込む。
 * @param {string} notesDir
 * @param {string} filename
 * @param {string} content
 * @param {{mode?: 'create'|'overwrite'}} [options] 'create'（既定）は既存ファイルがあればエラーにする
 * @returns {string} 書き込んだファイルのフルパス
 */
export function writeNote(notesDir, filename, content, { mode = 'create' } = {}) {
  if (!fs.existsSync(notesDir) || !fs.statSync(notesDir).isDirectory()) {
    throw new Error(`書き込み先ディレクトリが存在しません: ${notesDir}`);
  }
  const fullPath = path.join(notesDir, filename);
  if (mode === 'create' && fs.existsSync(fullPath)) {
    throw new Error(`既にファイルが存在します（意図的な上書きにはmode: 'overwrite'を使う）: ${filename}`);
  }
  if (mode !== 'create' && mode !== 'overwrite') {
    throw new Error(`不明なmode: ${mode}`);
  }
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}
