// output_data配下の全ファイルを走査し、DBに投入する（フルビルド）。
// insertBookが1冊ごとにトランザクションをコミットするため、途中で中断しても
// それまでに処理した分は保持される。
import fs from 'node:fs';
import path from 'node:path';
import { parseBookMarkdown } from './parse.js';
import { insertBook } from './persist.js';
import { sha256 } from '../lib/hash.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} outputDataDir
 * @returns {{total: number, inserted: number, failed: Array<{file: string, reason: string}>}}
 */
export function runFullBuild(db, outputDataDir) {
  const files = fs.readdirSync(outputDataDir).filter((f) => f.endsWith('.md'));
  const summary = { total: files.length, inserted: 0, failed: [] };

  for (const file of files) {
    const fullPath = path.join(outputDataDir, file);
    const rawText = fs.readFileSync(fullPath, 'utf8');
    const stat = fs.statSync(fullPath);

    const parsed = parseBookMarkdown(rawText, { fileName: file });
    if (!parsed.ok) {
      summary.failed.push({ file, reason: parsed.reason });
      continue;
    }

    insertBook(db, {
      filePath: file,
      fileMtime: stat.mtimeMs.toString(),
      contentHash: sha256(rawText),
      parsed: parsed.data,
    });
    summary.inserted++;
  }

  return summary;
}
