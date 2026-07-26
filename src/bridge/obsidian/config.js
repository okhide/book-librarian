// Obsidian Vaultパスの設定読み込み（doc/06_implementation_plan.md Phase 8）。
// GEMINI_API_KEYと同じ方式（.envファイル、process.loadEnvFile）で扱う。
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_NOTES_SUBDIR = 'book-librarian';

/**
 * .envのOBSIDIAN_VAULT_PATHからVaultパスを取得し、ディレクトリの実在を検証する。
 * 呼び出し側で事前に process.loadEnvFile('.env') 済みであることを前提とする
 * （CLIエントリポイントで1回だけ呼べば十分なため、ここでは行わない）。
 * @returns {string}
 */
export function getVaultPath() {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
  if (!vaultPath) {
    throw new Error(
      'OBSIDIAN_VAULT_PATHが設定されていません。.envファイルにObsidian Vaultへのパスを設定してください。'
    );
  }
  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    throw new Error(`OBSIDIAN_VAULT_PATHが指すディレクトリが存在しません: ${vaultPath}`);
  }
  return vaultPath;
}

/**
 * ノートの書き出し先ディレクトリ（Vault内のサブフォルダ）を取得する。
 * 既定は"book-librarian"。.envの OBSIDIAN_NOTES_SUBDIR で変更できる
 * （空文字を指定するとVault直下になる）。無ければ作成する。
 * @returns {string}
 */
export function getNotesDir() {
  const vaultPath = getVaultPath();
  const subDir = process.env.OBSIDIAN_NOTES_SUBDIR ?? DEFAULT_NOTES_SUBDIR;
  const notesDir = subDir ? path.join(vaultPath, subDir) : vaultPath;
  fs.mkdirSync(notesDir, { recursive: true });
  return notesDir;
}
