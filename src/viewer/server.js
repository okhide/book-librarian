#!/usr/bin/env node
// 蔵書DBの検索ビューア/エディタ（ローカル専用のWebサーバー）。
// 使い方: node src/viewer/server.js [--port N]
//
// 書き込みは reading_status（読書状態）と、books の「手編集しても安全な列」
// （書誌情報・要約・reader_level）に限る。file_path/status/各種ハッシュ・csv_*・
// keywords/topics・ISBN/NDC補完結果は、フルリビルドや専用フロー(enrich.js)で
// 管理される導出データ・キー情報のため、ここからは編集できない
// （doc/07_user_manual.md「viewerの編集モード」、src/build/persist.js
// updateBookEditableFieldsのコメント参照）。
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { resolveDbPath } from '../cli/dbPath.js';
import { createEmbedder } from '../lib/embed.js';
import { hybridSearch } from '../lib/hybridSearch.js';
import { setReadingStatus, getReadingStatus, VALID_STATUSES } from '../lib/readingStatus.js';
import { updateBookEditableFields } from '../build/persist.js';
import { layout, searchPage, resultsFragment, bookDetailPage, readingStatusForm, LEVEL_LABELS } from './views.js';

const VALID_READER_LEVELS = Object.keys(LEVEL_LABELS);

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../../public/', import.meta.url)));

function loadFilterOptions(db) {
  const categories = db
    .prepare(
      "SELECT DISTINCT category_raw FROM books WHERE status = 'summarized' AND category_raw IS NOT NULL ORDER BY category_raw"
    )
    .all()
    .map((r) => r.category_raw);
  const topics = db
    .prepare('SELECT DISTINCT topic FROM book_topics ORDER BY topic')
    .all()
    .map((r) => r.topic);
  return { categories, topics };
}

function loadReadingStatusByFilePath(db, filePaths) {
  const map = new Map();
  if (filePaths.length === 0) return map;
  const placeholders = filePaths.map(() => '?').join(',');
  for (const row of db
    .prepare(`SELECT * FROM reading_status WHERE file_path IN (${placeholders})`)
    .all(...filePaths)) {
    map.set(row.file_path, row);
  }
  return map;
}

/** @param {import('better-sqlite3').Database} db @param {import('@huggingface/transformers').FeatureExtractionPipeline} extractor */
export function createApp(db, extractor) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(PUBLIC_DIR));

  app.get('/', (req, res) => {
    const filterOptions = loadFilterOptions(db);
    res.type('html').send(layout('蔵書検索', searchPage(filterOptions)));
  });

  app.get('/search', async (req, res) => {
    const q = (req.query.q ?? '').toString().trim();
    if (!q) {
      res.type('html').send('');
      return;
    }

    const year = req.query.year ? Number(req.query.year) : undefined;
    const category = req.query.category ? String(req.query.category) : undefined;
    const topic = req.query.topic ? String(req.query.topic) : undefined;
    const level = req.query.level ? String(req.query.level) : undefined;
    const unreadOnly = req.query.unread === 'on';

    const { totalCount, results } = await hybridSearch(db, extractor, q, {
      limit: 20,
      year,
      category,
      topic,
      level,
      unreadOnly,
    });

    const readingStatusByFilePath = loadReadingStatusByFilePath(
      db,
      results.map((r) => r.book.file_path)
    );

    res.type('html').send(resultsFragment(totalCount, results, readingStatusByFilePath));
  });

  app.get('/books/:id', (req, res) => {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(Number(req.params.id));
    if (!book) {
      res.status(404).type('html').send('本が見つかりません');
      return;
    }
    const keywords = db
      .prepare('SELECT keyword FROM book_keywords WHERE book_id = ?')
      .all(book.id)
      .map((r) => r.keyword);
    const topics = db
      .prepare('SELECT topic FROM book_topics WHERE book_id = ?')
      .all(book.id)
      .map((r) => r.topic);
    const readingStatus = getReadingStatus(db, book.file_path);
    const mode = req.query.mode === 'edit' ? 'edit' : 'view';
    const saved = req.query.saved === '1';

    res.type('html').send(
      layout(book.title, bookDetailPage(book, keywords, topics, readingStatus, { mode, saved }))
    );
  });

  app.post('/books/:id/edit', (req, res) => {
    const book = db.prepare('SELECT id FROM books WHERE id = ?').get(Number(req.params.id));
    if (!book) {
      res.status(404).type('html').send('本が見つかりません');
      return;
    }

    const b = req.body;
    const readerLevel = b.readerLevel || null;
    if (readerLevel && !VALID_READER_LEVELS.includes(readerLevel)) {
      res.status(400).type('html').send('不正な読者レベルです');
      return;
    }

    let reliability = null;
    if (b.reliability !== undefined && b.reliability !== '') {
      reliability = Number(b.reliability);
      if (!Number.isInteger(reliability) || reliability < 0 || reliability > 3) {
        res.status(400).type('html').send('信頼度スコアは0〜3の整数で指定してください');
        return;
      }
    }

    let publicationYear = null;
    if (b.publicationYear !== undefined && b.publicationYear !== '') {
      publicationYear = Number(b.publicationYear);
      if (!Number.isInteger(publicationYear)) {
        res.status(400).type('html').send('出版年は整数で指定してください');
        return;
      }
    }

    updateBookEditableFields(db, book.id, {
      title: b.title ?? '',
      author: b.author || null,
      publisher: b.publisher || null,
      series: b.series || null,
      edition: b.edition || null,
      isbn: b.isbn || null,
      publicationDate: b.publicationDate || null,
      publicationYear,
      categoryRaw: b.categoryRaw || null,
      reliability,
      driveUrl: b.driveUrl || null,
      summaryLong: b.summaryLong ?? '',
      summaryShort: b.summaryShort ?? '',
      readerLevel,
    });

    res.redirect(303, `/books/${book.id}?mode=edit&saved=1`);
  });

  app.post('/books/:id/reading-status', (req, res) => {
    const book = db.prepare('SELECT id, file_path FROM books WHERE id = ?').get(Number(req.params.id));
    if (!book) {
      res.status(404).type('html').send('本が見つかりません');
      return;
    }
    if (!VALID_STATUSES.includes(req.body.status)) {
      res.status(400).type('html').send('不正な読書状態です');
      return;
    }

    const updated = setReadingStatus(db, book.file_path, {
      status: req.body.status,
      rating: req.body.rating ? Number(req.body.rating) : undefined,
      note: req.body.note,
    });

    res.type('html').send(readingStatusForm(book.id, updated, '保存しました'));
  });

  return app;
}

async function main() {
  const port = process.argv.includes('--port')
    ? Number(process.argv[process.argv.indexOf('--port') + 1])
    : Number(process.env.PORT ?? 3000);

  console.log('埋め込みモデルを読み込んでいます...');
  const extractor = await createEmbedder();
  const db = new Database(resolveDbPath());

  const app = createApp(db, extractor);
  app.listen(port, '127.0.0.1', () => {
    console.log(`蔵書ビューア: http://127.0.0.1:${port} を開いてください`);
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
