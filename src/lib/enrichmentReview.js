// ISBN・NDC補完で「見つからない」「複数候補のまま」だった本のレビューキュー操作。
// 自動判断はせず、人間が内容を見て手動でresolve（確定）またはskip（対象外）を選ぶ。
import { getFilePathForBookId } from './readingStatus.js';

/**
 * レビュー待ちの本を一覧する（books結合済み）。
 * @param {import('better-sqlite3').Database} db
 * @param {{status?: 'not_found'|'needs_review'}} [options]
 */
export function listEnrichmentCandidates(db, options = {}) {
  const { status } = options;
  const where = status ? 'WHERE ec.status = ?' : '';
  const params = status ? [status] : [];
  return db
    .prepare(
      `SELECT b.id as book_id, ec.file_path, b.title, b.author, ec.status, ec.source,
              ec.candidate_count, ec.conflicting_ndc, ec.created_at
       FROM enrichment_candidates ec
       JOIN books b ON b.file_path = ec.file_path
       ${where}
       ORDER BY ec.created_at ASC`
    )
    .all(...params);
}

/** 人間の判断でISBN・NDCを確定させる。候補一覧から該当行を取り除く。 */
export function resolveEnrichmentCandidate(db, bookId, { isbn, ndc }) {
  const filePath = getFilePathForBookId(db, bookId);
  if (!filePath) throw new Error(`id=${bookId} の本が見つかりません`);

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE books SET enriched_isbn = ?, enriched_ndc = ?, enriched_source = 'manual',
       enrichment_status = 'matched', updated_at = ? WHERE id = ?`
  ).run(isbn ?? null, ndc ?? null, now, bookId);
  db.prepare('DELETE FROM enrichment_candidates WHERE file_path = ?').run(filePath);

  return db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
}

/** レビュー不要と判断した本を対象外にする（再度レビュー一覧に出さない）。 */
export function skipEnrichmentCandidate(db, bookId) {
  const filePath = getFilePathForBookId(db, bookId);
  if (!filePath) throw new Error(`id=${bookId} の本が見つかりません`);

  const now = new Date().toISOString();
  db.prepare("UPDATE books SET enrichment_status = 'skipped', updated_at = ? WHERE id = ?").run(now, bookId);
  db.prepare('DELETE FROM enrichment_candidates WHERE file_path = ?').run(filePath);

  return db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
}
