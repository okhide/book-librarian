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

/** book_keywords/book_topics のうちその本に属する行を全削除する。 */
function deleteChildRows(db, bookId) {
  db.prepare('DELETE FROM book_keywords WHERE book_id = ?').run(bookId);
  db.prepare('DELETE FROM book_topics WHERE book_id = ?').run(bookId);
}

/** embed_source_hashが変わった本の古い埋め込みだけを削除する（不要な再生成を避けるため）。 */
function deleteEmbeddingIfSourceChanged(db, bookId, newEmbedSourceHash) {
  const current = db.prepare('SELECT embed_source_hash FROM books WHERE id = ?').get(bookId);
  if (current && current.embed_source_hash !== newEmbedSourceHash) {
    db.prepare('DELETE FROM book_embeddings WHERE book_id = ?').run(bookId);
  }
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
// isbn・titleはISBN/NDC補完のキーとなる項目。変わった場合は過去の補完結果が
// 別の本を指す可能性があるため、補完済みデータを無効化し再補完の対象に戻す。
function resetEnrichmentIfIdentityChanged(db, bookId, newIsbn, newTitle) {
  const current = db.prepare('SELECT isbn, title FROM books WHERE id = ?').get(bookId);
  if (current && (current.isbn !== newIsbn || current.title !== newTitle)) {
    db.prepare(
      'UPDATE books SET enriched_isbn = NULL, enriched_ndc = NULL, enriched_source = NULL, enrichment_status = NULL WHERE id = ?'
    ).run(bookId);
    const filePath = db.prepare('SELECT file_path FROM books WHERE id = ?').get(bookId)?.file_path;
    if (filePath) db.prepare('DELETE FROM enrichment_candidates WHERE file_path = ?').run(filePath);
  }
}

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
    deleteEmbeddingIfSourceChanged(db, bookId, p.embedSourceHash);
    resetEnrichmentIfIdentityChanged(db, bookId, p.isbn, p.title);
    stmt.run({ bookId, filePath, fileMtime, contentHash, ...p, updatedAt: now });
    deleteChildRows(db, bookId);
    insertKeywords(db, bookId, parsed.keywords);
  });
  run();
}

const EDITABLE_FIELD_TO_COLUMN = {
  title: 'title',
  author: 'author',
  publisher: 'publisher',
  series: 'series',
  edition: 'edition',
  isbn: 'isbn',
  publicationDate: 'publication_date',
  publicationYear: 'publication_year',
  categoryRaw: 'category_raw',
  reliability: 'reliability',
  driveUrl: 'drive_url',
  summaryLong: 'summary_long',
  summaryShort: 'summary_short',
  readerLevel: 'reader_level',
};

/**
 * viewerの編集モードから、書誌情報・要約・読者レベルなど「手編集しても壊れない」列だけを更新する。
 * file_path/status/各種ハッシュ・csv_*・keywords/topics・ISBN/NDC補完結果には触れない
 * （導出データ・キー情報のため。doc/07_user_manual.md「viewerの編集モード」参照）。
 * search_text/embed_source_hashは編集後の内容から再合成し、isbn/titleが変わった場合は
 * updateBook同様にISBN/NDC補完結果を無効化する。
 * @param {import('better-sqlite3').Database} db
 * @param {number} bookId
 * @param {Partial<Record<keyof typeof EDITABLE_FIELD_TO_COLUMN, string|number|null>>} fields キーはEDITABLE_FIELD_TO_COLUMNのキーと同じ（camelCase）
 * @returns {object} 更新後のbooks行
 */
export function updateBookEditableFields(db, bookId, fields) {
  const current = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!current) throw new Error(`id=${bookId} の本が見つかりません`);

  const merged = { ...current };
  for (const [field, column] of Object.entries(EDITABLE_FIELD_TO_COLUMN)) {
    if (field in fields) merged[column] = fields[field];
  }

  const keywords = getKeywordsForBook(db, bookId);
  const topics = getTopicsForBook(db, bookId);
  const searchText = buildSearchText({
    title: merged.title,
    author: merged.author,
    keywords,
    topics,
    summaryLong: merged.summary_long,
    summaryShort: merged.summary_short,
  });
  const embedSourceText = buildEmbedSourceText({
    title: merged.title,
    author: merged.author,
    keywords,
    topics,
    summaryLong: merged.summary_long,
  });
  const embedSourceHash = sha256(embedSourceText);
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    deleteEmbeddingIfSourceChanged(db, bookId, embedSourceHash);
    resetEnrichmentIfIdentityChanged(db, bookId, merged.isbn, merged.title);
    db.prepare(
      `UPDATE books SET
         title = @title, author = @author, publisher = @publisher, series = @series,
         edition = @edition, isbn = @isbn, publication_date = @publication_date,
         publication_year = @publication_year, category_raw = @category_raw,
         reliability = @reliability, drive_url = @drive_url,
         summary_long = @summary_long, summary_short = @summary_short,
         reader_level = @reader_level, search_text = @search_text,
         embed_source_hash = @embed_source_hash, updated_at = @updated_at
       WHERE id = @id`
    ).run({ ...merged, search_text: searchText, embed_source_hash: embedSourceHash, updated_at: now });
  });
  run();

  return db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
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

export function getTopicsForBook(db, bookId) {
  return db
    .prepare('SELECT topic FROM book_topics WHERE book_id = ? ORDER BY rowid')
    .all(bookId)
    .map((r) => r.topic);
}

/**
 * 1冊のtopicsを適用する（Step 3.4）。title/author/summary等には触れず、
 * book_topics・search_text・embed_source_hash・topic_dict_versionだけを更新する。
 * embed_source_hashが変わった場合は既存の埋め込みを削除し、Phase 2の
 * generateMissingEmbeddingsが再生成できるようにする。
 * @param {import('better-sqlite3').Database} db
 * @param {number} bookId
 * @param {string[]} topics
 * @param {string} dictVersion 辞書（taxonomy+mapping+overrides）のバージョンハッシュ
 */
export function applyTopicsForBook(db, bookId, topics, dictVersion) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  const keywords = getKeywordsForBook(db, bookId);

  const searchText = buildSearchText({
    title: book.title,
    author: book.author,
    keywords,
    topics,
    summaryLong: book.summary_long,
    summaryShort: book.summary_short,
  });
  const embedSourceText = buildEmbedSourceText({
    title: book.title,
    author: book.author,
    keywords,
    topics,
    summaryLong: book.summary_long,
  });
  const embedSourceHash = sha256(embedSourceText);

  const run = db.transaction(() => {
    deleteEmbeddingIfSourceChanged(db, bookId, embedSourceHash);
    db.prepare('DELETE FROM book_topics WHERE book_id = ?').run(bookId);
    const insertTopic = db.prepare('INSERT INTO book_topics (book_id, topic) VALUES (?, ?)');
    for (const topic of topics) insertTopic.run(bookId, topic);
    db.prepare(
      'UPDATE books SET search_text = ?, embed_source_hash = ?, topic_dict_version = ?, updated_at = ? WHERE id = ?'
    ).run(searchText, embedSourceHash, dictVersion, new Date().toISOString(), bookId);
  });
  run();
}

/** status='pending'の本の中から、csv_filenameがmdFilenameに対応するものを探す。 */
export function findPendingBookByMdFilename(db, mdFilename) {
  const pendingBooks = db
    .prepare("SELECT * FROM books WHERE status = 'pending' AND csv_filename IS NOT NULL")
    .all();
  return pendingBooks.find((b) => b.csv_filename.replace(/\.pdf$/i, '.md') === mdFilename) ?? null;
}
