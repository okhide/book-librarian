#!/usr/bin/env node
// 使い方: node src/cli/show.js <id> [--json]
// summary_longを無加工で全文出力する（切り詰め・要約は一切行わない）。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const idArg = argv.find((a) => !a.startsWith('--'));

if (!idArg) {
  console.error('使い方: node src/cli/show.js <id> [--json]');
  process.exitCode = 1;
} else {
  const db = new Database(resolveDbPath(), { readonly: true });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(Number(idArg));

  if (!book) {
    console.error(`id=${idArg} の本が見つかりません`);
    process.exitCode = 1;
  } else {
    const keywords = db
      .prepare('SELECT keyword FROM book_keywords WHERE book_id = ?')
      .all(book.id)
      .map((r) => r.keyword);

    if (json) {
      console.log(JSON.stringify({ ...book, keywords }, null, 2));
    } else {
      console.log(`【${book.title}】`);
      console.log(
        `著者: ${book.author ?? '不明'} / 出版社: ${book.publisher ?? '不明'} / 出版年: ${book.publication_year ?? '不明'}`
      );
      console.log(`キーワード: ${keywords.join('、')}`);
      console.log('');
      console.log(book.summary_long);
    }
  }

  db.close();
}
