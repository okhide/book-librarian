#!/usr/bin/env node
// 使い方: node src/cli/show.js <id> [--json]
// summary_longを無加工で全文出力する（切り詰め・要約は一切行わない）。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { parseFlags } from './argParse.js';

const SPEC = { json: { flag: '--json', type: 'boolean' } };
const USAGE = '使い方: node src/cli/show.js <id> [--json]';

function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2), SPEC);
  const idArg = positional[0];

  if (!idArg) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const db = new Database(resolveDbPath(), { readonly: true });
  try {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(Number(idArg));
    if (!book) {
      console.error(`id=${idArg} の本が見つかりません`);
      process.exitCode = 1;
      return;
    }

    const keywords = db
      .prepare('SELECT keyword FROM book_keywords WHERE book_id = ?')
      .all(book.id)
      .map((r) => r.keyword);

    if (flags.json) {
      console.log(JSON.stringify({ ...book, keywords }, null, 2));
    } else {
      console.log(`【${book.title}】`);
      console.log(
        `著者: ${book.author ?? '不明'} / 出版社: ${book.publisher ?? '不明'} / 出版年: ${book.publication_year ?? '不明'}`
      );
      console.log(`キーワード: ${keywords.join('、')}`);
      if (book.drive_url) console.log(`蔵書本体（Google Drive）: ${book.drive_url}`);
      console.log('');
      console.log(book.summary_long);
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
