// spike S13: Express + htmx でビューア/エディタが成立するか（配線の確認）。
// 確認したいこと:
// - 埋め込みモデル(createEmbedder)をサーバー起動時に1回だけロードし、
//   リクエストごとに使い回せるか（hybridSearchが要求するextractorの再利用）。
// - GET /search がhtmxのhx-get想定のクエリパラメータ（フォーム全体をシリアライズしたもの）を
//   受け取り、結果のHTML断片だけを返せるか。
// - POST /books/:id/reading-status が reading_status のみを更新し、books等の
//   導出データには一切書き込まないか（setReadingStatusをそのまま呼ぶだけで済むか）。
// - drive_url を <a target="_blank"> としてそのまま出せるか（クリックで新規タブが開く想定）。
//
// 使い方: node spike/s13_viewer_htmx.mjs
import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../src/lib/schema.js';
import { runFullBuild } from '../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../src/build/embedBuild.js';
import { createEmbedder } from '../src/lib/embed.js';
import { hybridSearch } from '../src/lib/hybridSearch.js';
import { setReadingStatus, getReadingStatus } from '../src/lib/readingStatus.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

function createApp(db, extractor) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));

  app.get('/', (req, res) => {
    res.type('html').send('<form><input name="q"></form><div id="results"></div>');
  });

  app.get('/search', async (req, res) => {
    const q = req.query.q ?? '';
    if (!q) return res.type('html').send('');
    const { results } = await hybridSearch(db, extractor, q, { limit: 10 });
    const html = results
      .map((r) => `<div class="book" data-id="${r.book.id}"><a href="/books/${r.book.id}">${r.book.title}</a></div>`)
      .join('');
    res.type('html').send(html);
  });

  app.get('/books/:id', (req, res) => {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(Number(req.params.id));
    if (!book) return res.status(404).send('not found');
    const driveLink = book.drive_url ? `<a href="${book.drive_url}" target="_blank" rel="noopener">Drive</a>` : '';
    res.type('html').send(`<h1>${book.title}</h1>${driveLink}`);
  });

  app.post('/books/:id/reading-status', (req, res) => {
    const book = db.prepare('SELECT file_path FROM books WHERE id = ?').get(Number(req.params.id));
    if (!book) return res.status(404).send('not found');
    const updated = setReadingStatus(db, book.file_path, {
      status: req.body.status,
      rating: req.body.rating ? Number(req.body.rating) : undefined,
      note: req.body.note,
    });
    res.type('html').send(`<div id="reading-status-panel">status=${updated.status}</div>`);
  });

  return app;
}

async function main() {
  const extractor = await createEmbedder();
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  await generateMissingEmbeddings(db, extractor);

  const app = createApp(db, extractor);
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  let failCount = 0;
  function check(label, cond) {
    console.log(`${cond ? 'OK' : 'NG'}: ${label}`);
    if (!cond) failCount++;
  }

  // 1. 検索
  const searchRes = await fetch(`${base}/search?q=会計`);
  const searchHtml = await searchRes.text();
  check('検索結果に本のタイトルへのリンクが含まれる', /<a href="\/books\/\d+">/.test(searchHtml));

  // 2. 詳細（drive_urlがクリック可能リンクになっている本を探す）
  const bookWithDrive = db.prepare("SELECT id FROM books WHERE drive_url IS NOT NULL AND drive_url != '' LIMIT 1").get();
  check('drive_urlを持つ本がfixturesに存在する（前提確認）', !!bookWithDrive);
  if (bookWithDrive) {
    const detailRes = await fetch(`${base}/books/${bookWithDrive.id}`);
    const detailHtml = await detailRes.text();
    check('詳細ページでdrive_urlがtarget="_blank"のリンクになっている', /<a href="[^"]+" target="_blank"/.test(detailHtml));
  }

  // 3. reading_status更新（booksテーブルには影響しないことも確認）
  const anyBook = db.prepare('SELECT id, file_path, title FROM books LIMIT 1').get();
  const titleBefore = db.prepare('SELECT title FROM books WHERE id = ?').get(anyBook.id).title;
  const postRes = await fetch(`${base}/books/${anyBook.id}/reading-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ status: 'reading', rating: '', note: 'test note' }),
  });
  const postHtml = await postRes.text();
  check('POST後のレスポンスにstatus=readingが含まれる', postHtml.includes('status=reading'));

  const persisted = getReadingStatus(db, anyBook.file_path);
  check('reading_statusがDBに永続化されている', persisted?.status === 'reading' && persisted?.note === 'test note');

  const titleAfter = db.prepare('SELECT title FROM books WHERE id = ?').get(anyBook.id).title;
  check('reading_status更新がbooksテーブルのtitleに影響しない', titleBefore === titleAfter);

  server.close();
  db.close();

  console.log(failCount === 0 ? '\n全チェックOK' : `\n${failCount}件のチェックが失敗`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
