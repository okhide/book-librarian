// doc/03_specification.md の「スキーマ（案）」をそのままDDL化したもの。
// reading_status はPhase 5で使うが、フルリビルドがユーザーデータを消さないという
// 不変条件を最初のフェーズからテスト可能にするため、この段階でテーブルを作る。

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  file_path TEXT UNIQUE,
  file_mtime TEXT,
  content_hash TEXT,
  embed_source_hash TEXT,
  topic_dict_version TEXT,
  status TEXT NOT NULL DEFAULT 'summarized',
  csv_serial INTEGER,
  csv_filename TEXT,
  csv_updated_at TEXT,
  title TEXT,
  title_is_fallback INTEGER NOT NULL DEFAULT 0,
  author TEXT,
  publisher TEXT,
  series TEXT,
  edition TEXT,
  isbn TEXT,
  publication_date TEXT,
  category_raw TEXT,
  reliability INTEGER,
  drive_url TEXT,
  summarized_at TEXT,
  summary_long TEXT,
  summary_short TEXT,
  summary_long_is_fallback INTEGER NOT NULL DEFAULT 0,
  reader_level TEXT,
  reader_level_source TEXT,
  publication_year INTEGER,
  search_text TEXT,
  enriched_isbn TEXT,
  enriched_ndc TEXT,
  enriched_source TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_keywords (
  book_id INTEGER REFERENCES books(id),
  keyword TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_topics (
  book_id INTEGER REFERENCES books(id),
  topic TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_embeddings (
  book_id INTEGER PRIMARY KEY REFERENCES books(id),
  embedding BLOB NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_level ON books(reader_level);
CREATE INDEX IF NOT EXISTS idx_books_year ON books(publication_year);
CREATE INDEX IF NOT EXISTS idx_book_topics_topic ON book_topics(topic);
CREATE INDEX IF NOT EXISTS idx_book_keywords_keyword ON book_keywords(keyword);

-- ユーザー所有の一次データ。フルリビルドで絶対に消してはならない（doc/03_specification.md参照）。
CREATE TABLE IF NOT EXISTS reading_status (
  file_path TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  rating INTEGER,
  note TEXT,
  updated_at TEXT NOT NULL
);
`;

/** DBに全テーブル・インデックスを作成する（既存なら何もしない）。 */
export function initSchema(db) {
  db.exec(SCHEMA_SQL);
}

/** フルリビルド対象の導出データテーブル一覧（reading_statusは含まない）。 */
export const DERIVED_TABLES = ['book_embeddings', 'book_topics', 'book_keywords', 'books'];
