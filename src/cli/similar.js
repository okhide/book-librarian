#!/usr/bin/env node
// 使い方: node src/cli/similar.js <id> [--limit N] [--json]
// 既存の埋め込みを再利用するだけなので埋め込みモデルのロードは不要。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { searchSimilarToBook } from '../lib/vectorSearch.js';

function parseArgs(argv) {
  const args = { limit: 10, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else rest.push(a);
  }
  args.id = Number(rest[0]);
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.id) {
  console.error('使い方: node src/cli/similar.js <id> [--limit N] [--json]');
  process.exitCode = 1;
} else {
  const db = new Database(resolveDbPath(), { readonly: true });
  const base = db.prepare('SELECT * FROM books WHERE id = ?').get(args.id);

  if (!base) {
    console.error(`id=${args.id} の本が見つかりません`);
    process.exitCode = 1;
  } else {
    const results = searchSimilarToBook(db, args.id, args.limit);
    if (results === null) {
      console.error(`id=${args.id} の本に埋め込みが無いため類似本を検索できません`);
      process.exitCode = 1;
    } else {
      const getBook = db.prepare('SELECT * FROM books WHERE id = ?');
      const enriched = results.map((r) => ({ ...r, book: getBook.get(r.bookId) }));

      if (args.json) {
        console.log(
          JSON.stringify(enriched.map((r) => ({ id: r.book.id, title: r.book.title, score: r.score })), null, 2)
        );
      } else {
        console.log(`「${base.title}」に似ている本:`);
        enriched.forEach((r, i) => console.log(`${i + 1}. [${r.book.id}] ${r.book.title} (score=${r.score.toFixed(3)})`));
      }
    }
  }

  db.close();
}
