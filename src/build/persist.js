// 1冊分のパース結果(src/build/parse.jsの出力)をDBに書き込む。
// Step 1.3の範囲: 新規1冊の挿入と読み戻し。差分更新（更新・削除・冪等性）はStep 1.6で実装する。
import { buildSearchText, buildEmbedSourceText } from '../lib/text.js';
import { sha256 } from '../lib/hash.js';

/**
 * パース済みの1冊分データをbooks/book_keywordsに挿入する。
 * @param {import('better-sqlite3').Database} db
 * @param {{filePath: string, fileMtime: string, contentHash: string, parsed: object}} args
 * @returns {number} 挿入したbooks.id
 */
export function insertBook(db, { filePath, fileMtime, contentHash, parsed }) {
  const now = new Date().toISOString();
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
  const embedSourceHash = sha256(embedSourceText);

  const insertBookStmt = db.prepare(`
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

  const insertKeywordStmt = db.prepare(
    'INSERT INTO book_keywords (book_id, keyword) VALUES (?, ?)'
  );

  const run = db.transaction(() => {
    const result = insertBookStmt.run({
      filePath,
      fileMtime,
      contentHash,
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
      updatedAt: now,
    });
    const bookId = result.lastInsertRowid;
    for (const keyword of parsed.keywords ?? []) {
      insertKeywordStmt.run(bookId, keyword);
    }
    return bookId;
  });

  return run();
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
