// output_dataの差分更新。変更のあった本だけを処理する（doc/03_specification.md「差分更新の要件」参照）。
// - file_mtimeを一次フィルタ、content_hashで確定判定する二段構え
// - 既存のpending本に対応するファイルが出現したらsummarizedに昇格させる
// - 実ファイルが消えた本は論理削除する（status='deleted'）
// - 同じ状態で2回実行しても結果が変わらない（冪等）
import fs from 'node:fs';
import path from 'node:path';
import { parseBookMarkdown } from './parse.js';
import { sha256 } from '../lib/hash.js';
import {
  insertBook,
  updateBook,
  touchFileMtime,
  markDeleted,
  findPendingBookByMdFilename,
} from './persist.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} outputDataDir
 * @returns {{added: number, promoted: number, updated: number, skipped: number, deleted: number, failed: Array<{file:string, reason:string}>}}
 */
export function runDiffUpdate(db, outputDataDir) {
  const summary = { added: 0, promoted: 0, updated: 0, skipped: 0, deleted: 0, failed: [] };

  const currentFiles = new Set(fs.readdirSync(outputDataDir).filter((f) => f.endsWith('.md')));

  const existingByFilePath = new Map(
    db
      .prepare("SELECT * FROM books WHERE file_path IS NOT NULL AND status != 'pending'")
      .all()
      .map((row) => [row.file_path, row])
  );

  for (const file of currentFiles) {
    const fullPath = path.join(outputDataDir, file);
    const stat = fs.statSync(fullPath);
    const fileMtime = stat.mtimeMs.toString();
    const existing = existingByFilePath.get(file);

    if (existing) {
      if (existing.status !== 'deleted' && existing.file_mtime === fileMtime) {
        summary.skipped++;
        continue; // mtime一致 → ファイルを開かず何もしない
      }

      const rawText = fs.readFileSync(fullPath, 'utf8');
      const contentHash = sha256(rawText);

      if (existing.status !== 'deleted' && existing.content_hash === contentHash) {
        // mtimeだけ変わって内容は同一 → 再パース・埋め込み再生成はスキップ
        touchFileMtime(db, existing.id, fileMtime);
        summary.skipped++;
        continue;
      }

      const parsed = parseBookMarkdown(rawText, { fileName: file });
      if (!parsed.ok) {
        summary.failed.push({ file, reason: parsed.reason });
        continue;
      }
      updateBook(db, existing.id, { filePath: file, fileMtime, contentHash, parsed: parsed.data });
      summary.updated++;
      continue;
    }

    // file_pathでの既存行が無い場合、pendingとして登録済みの本かもしれない
    const pendingMatch = findPendingBookByMdFilename(db, file);
    const rawText = fs.readFileSync(fullPath, 'utf8');
    const contentHash = sha256(rawText);
    const parsed = parseBookMarkdown(rawText, { fileName: file });
    if (!parsed.ok) {
      summary.failed.push({ file, reason: parsed.reason });
      continue;
    }

    if (pendingMatch) {
      updateBook(db, pendingMatch.id, { filePath: file, fileMtime, contentHash, parsed: parsed.data });
      summary.promoted++;
    } else {
      insertBook(db, { filePath: file, fileMtime, contentHash, parsed: parsed.data });
      summary.added++;
    }
  }

  // 実ファイルが無くなった本を論理削除する
  for (const [filePath, row] of existingByFilePath) {
    if (row.status !== 'deleted' && !currentFiles.has(filePath)) {
      markDeleted(db, row.id);
      summary.deleted++;
    }
  }

  return summary;
}
