// 蔵書リスト.csv とbooksテーブルの突き合わせ。
// - output_dataに対応ファイルがある行 -> 既存のbooks行にcsv_*列を記録する
// - 対応ファイルが無い行 -> status='pending'の新規行を追加する（要約未生成の本）
import { pickCanonicalRowsByMdFilename, csvFilenameToMdFilename } from './csv.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {Array} csvRows parseCatalogCsvの出力(rows)
 * @returns {{matched: number, pendingInserted: number}}
 */
export function reconcileCatalog(db, csvRows) {
  const canonicalByMdFilename = pickCanonicalRowsByMdFilename(csvRows);

  const findBookStmt = db.prepare('SELECT id FROM books WHERE file_path = ?');
  const updateCsvFieldsStmt = db.prepare(`
    UPDATE books SET csv_serial = ?, csv_filename = ?, csv_updated_at = ?, updated_at = ?
    WHERE id = ?
  `);
  const insertPendingStmt = db.prepare(`
    INSERT INTO books (
      status, title, title_is_fallback, drive_url,
      csv_serial, csv_filename, csv_updated_at, updated_at
    ) VALUES ('pending', ?, 1, ?, ?, ?, ?, ?)
  `);

  const summary = { matched: 0, pendingInserted: 0 };
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    for (const [mdFilename, row] of canonicalByMdFilename) {
      const existing = findBookStmt.get(mdFilename);
      if (existing) {
        updateCsvFieldsStmt.run(row.csvSerial, row.csvFilename, row.csvUpdatedAt, now, existing.id);
        summary.matched++;
      } else {
        const titleFromFilename = csvFilenameToMdFilename(row.csvFilename).replace(/\.md$/i, '');
        insertPendingStmt.run(
          titleFromFilename,
          row.driveUrl,
          row.csvSerial,
          row.csvFilename,
          row.csvUpdatedAt,
          now
        );
        summary.pendingInserted++;
      }
    }
  });
  run();

  return summary;
}
