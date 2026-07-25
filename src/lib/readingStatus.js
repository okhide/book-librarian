// reading_status（ユーザー所有の一次データ）の読み書き。
// doc/03_specification.md「ユーザー所有データ（読書状態）」の通り、
// booksへの参照はidではなくfile_pathで行う（フルリビルドでidの採番が
//変わり得るため、file_pathの方が安定した参照キーになる）。

export const VALID_STATUSES = ['unread', 'reading', 'finished', 'abandoned'];

export function getReadingStatus(db, filePath) {
  return db.prepare('SELECT * FROM reading_status WHERE file_path = ?').get(filePath);
}

/**
 * 読書状態を記録・更新する（無ければ挿入、あれば更新）。
 * status='reading'に変わった際started_atが未設定なら設定し、
 * status='finished'に変わった際finished_atが未設定なら設定する。
 * @param {import('better-sqlite3').Database} db
 * @param {string} filePath
 * @param {{status: string, rating?: number, note?: string}} fields
 */
export function setReadingStatus(db, filePath, fields) {
  const { status, rating, note } = fields;
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`不明な読書状態: ${status}（有効値: ${VALID_STATUSES.join(', ')}）`);
  }

  const now = new Date().toISOString();
  const existing = getReadingStatus(db, filePath);

  const startedAt = existing?.started_at ?? (status === 'reading' ? now : null);
  const finishedAt = existing?.finished_at ?? (status === 'finished' ? now : null);

  db.prepare(
    `INSERT INTO reading_status (file_path, status, started_at, finished_at, rating, note, updated_at)
     VALUES (@filePath, @status, @startedAt, @finishedAt, @rating, @note, @updatedAt)
     ON CONFLICT(file_path) DO UPDATE SET
       status = @status, started_at = @startedAt, finished_at = @finishedAt,
       rating = @rating, note = @note, updated_at = @updatedAt`
  ).run({
    filePath,
    status,
    startedAt,
    finishedAt,
    rating: rating ?? existing?.rating ?? null,
    note: note ?? existing?.note ?? null,
    updatedAt: now,
  });

  return getReadingStatus(db, filePath);
}

/** @returns {Array} statusで絞り込んだ読書状態一覧。booksと結合してtitleを含める。 */
export function listReadingStatus(db, { status } = {}) {
  const conditions = [];
  const params = [];
  if (status != null) {
    conditions.push('rs.status = ?');
    params.push(status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db
    .prepare(
      `SELECT rs.*, b.title, b.id as book_id FROM reading_status rs
       LEFT JOIN books b ON b.file_path = rs.file_path
       ${where}
       ORDER BY rs.updated_at DESC`
    )
    .all(...params);
}

/** @returns {string|null} 指定idの本のfile_path。無ければnull（pending本等）。 */
export function getFilePathForBookId(db, bookId) {
  const row = db.prepare('SELECT file_path FROM books WHERE id = ?').get(bookId);
  return row?.file_path ?? null;
}
