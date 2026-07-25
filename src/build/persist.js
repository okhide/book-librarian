// 1冊分のパース結果(src/build/parse.jsの出力)をDBに書き込む。
// 新規挿入・更新・pendingからの昇格・論理削除をここに集約する。
import { buildSearchText, buildEmbedSourceText } from '../lib/text.js';
import { sha256 } from '../lib/hash.js';

function buildDerivedFields(parsed) {
  const topics = []; // Phase 3で正規化トピックが入るまでは空
  const searchText = buildSearchText({
    title: parsed.title,
    author: parsed.author,
    keywords: parsed.keywords,
    topics,
    summaryLong: parsed.summaryLong,
    summaryShort: parsed.summaryShort,
  });
  const embedSourceText = buildEmbedSourceText({
    title: parsed.title,
    author: parsed.author,
    keywords: parsed.keywords,
    topics,
    summaryLong: parsed.summaryLong,
  });
  return { searchText, embedSourceHash: sha256(embedSourceText) };
}

function toBookParams(parsed) {
  const { searchText, embedSourceHash } = buildDerivedFields(parsed);
  return {
    embedSourceHash,
    title: parsed.title,
    titleIsFallback: parsed.titleIsFallback ? 1 : 0,
    author: parsed.author,
    publisher: parsed.publisher,
    series: parsed.series,
    edition: parsed.edition,
    isbn: parsed.isbn,
    publicationDate: parsed.publicationDate,
    publicationYear: parsed.publicationYear,
    categoryRaw: parsed.categoryRaw,
    reliability: parsed.reliability,
    driveUrl: parsed.driveUrl,
    summarizedAt: parsed.summarizedAt,
    summaryLong: parsed.summaryLong,
    summaryShort: parsed.summaryShort,
    summaryLongIsFallback: parsed.summaryLongIsFallback ? 1 : 0,
    searchText,
  };
}

/** book_keywords/book_topics/book_embeddings のうちその本に属する行を全削除する。 */
function deleteChildRows(db, bookId) {
  db.prepare('DELETE FROM book_keywords WHERE book_id = ?').run(bookId);
  db.prepare('DELETE FROM book_topics WHERE book_id = ?').run(bookId);
  db.prepare('DELETE FROM book_embeddings WHERE book_id = ?').run(bookId);
}

function insertKeywords(db, bookId, keywords) {
  const stmt = db.prepare('INSERT INTO book_keywords (book_id, keyword) VALUES (?, ?)');
  for (const keyword of keywords ?? []) {
    stmt.run(bookId, keyword);
  }
}

/**
 * パース済みの1冊分データを新規挿入する。
 * @returns {number} 挿入したbooks.id
 */
export function insertBook(db, { filePath, fileMtime, contentHash, parsed }) {
  const now = new Date().toISOString();
  const p = toBookParams(parsed);

  const stmt = db.prepare(`
    INSERT INTO books (
      file_path, file_mtime, content_hash, embed_source_hash,
      status, title, title_is_fallback, author, publisher, series, edition, isbn,
      publication_date, publication_year, category_raw, reliability, drive_url,
      summarized_at, summary_long, summary_short, summary_long_is_fallback,
      search_text, updated_at
    ) VALUES (
      @filePath, @fileMtime, @contentHash, @embedSourceHash,
      'summarized', @title, @titleIsFallback, @author, @publisher, @series, @edition, @isbn,
      @publicationDate, @publicationYear, @categoryRaw, @reliability, @driveUrl,
      @summarizedAt, @summaryLong, @summaryShort, @summaryLongIsFallback,
      @searchText, @updatedAt
    )
  `);

  const run = db.transaction(() => {
    const result = stmt.run({ filePath, fileMtime, contentHash, ...p, updatedAt: now });
    const bookId = result.lastInsertRowid;
    insertKeywords(db, bookId, parsed.keywords);
    return bookId;
  });

  return run();
}

/**
 * 既存の本（summarized/deleted/pendingいずれも可）を更新する。
 * 関連テーブル(book_keywords/book_topics/book_embeddings)の旧行を削除して再挿入し、
 * search_text/embed_source_hashを再合成する（doc/03_specification.md「差分更新の要件」参照）。
 */
export function updateBook(db, bookId, { filePath, fileMtime, contentHash, parsed }) {
  const now = new Date().toISOString();
  const p = toBookParams(parsed);

  const stmt = db.prepare(`
    UPDATE books SET
      file_path = @filePath, file_mtime = @fileMtime, content_hash = @contentHash,
      embed_source_hash = @embedSourceHash, status = 'summarized',
      title = @title, title_is_fallback = @titleIsFallback, author = @author,
      publisher = @publisher, series = @series, edition = @edition, isbn = @isbn,
      publication_date = @publicationDate, publication_year = @publicationYear,
      category_raw = @categoryRaw, reliability = @reliability, drive_url = @driveUrl,
      summarized_at = @summarizedAt, summary_long = @summaryLong, summary_short = @summaryShort,
      summary_long_is_fallback = @summaryLongIsFallback, search_text = @searchText,
      updated_at = @updatedAt
    WHERE id = @bookId
  `);

  const run = db.transaction(() => {
    stmt.run({ bookId, filePath, fileMtime, contentHash, ...p, updatedAt: now });
    deleteChildRows(db, bookId);
    insertKeywords(db, bookId, parsed.keywords);
  });
  run();
}

/** file_mtimeだけを更新する（内容が変わっていない場合。再パース・埋め込み再生成は行わない）。 */
export function touchFileMtime(db, bookId, fileMtime) {
  db.prepare('UPDATE books SET file_mtime = ?, updated_at = ? WHERE id = ?').run(
    fileMtime,
    new Date().toISOString(),
    bookId
  );
}

/** 実ファイルが消えた本を論理削除する。子テーブルは残す（復活時に備える）。 */
export function markDeleted(db, bookId) {
  db.prepare("UPDATE books SET status = 'deleted', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    bookId
  );
}

export function getBookByFilePath(db, filePath) {
  return db.prepare('SELECT * FROM books WHERE file_path = ?').get(filePath);
}

export function getKeywordsForBook(db, bookId) {
  return db
    .prepare('SELECT keyword FROM book_keywords WHERE book_id = ? ORDER BY rowid')
    .all(bookId)
    .map((r) => r.keyword);
}

/** status='pending'の本の中から、csv_filenameがmdFilenameに対応するものを探す。 */
export function findPendingBookByMdFilename(db, mdFilename) {
  const pendingBooks = db
    .prepare("SELECT * FROM books WHERE status = 'pending' AND csv_filename IS NOT NULL")
    .all();
  return pendingBooks.find((b) => b.csv_filename.replace(/\.pdf$/i, '.md') === mdFilename) ?? null;
}
