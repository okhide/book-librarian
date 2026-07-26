#!/usr/bin/env node
// 使い方:
//   node src/cli/read.js <id> --status <unread|reading|finished|abandoned> [--rating N] [--note "..."]
//   node src/cli/read.js <id>                読書状態を確認するだけ
//   node src/cli/read.js --list [--status S]  一覧表示
//   node src/cli/read.js --dormant [--limit N] 未読のまま長期間放置されている本(死蔵本)を一覧
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { parseFlags } from './argParse.js';
import {
  getReadingStatus,
  setReadingStatus,
  listReadingStatus,
  getFilePathForBookId,
  findDormantBooks,
} from '../lib/readingStatus.js';

const SPEC = {
  json: { flag: '--json', type: 'boolean' },
  list: { flag: '--list', type: 'boolean' },
  dormant: { flag: '--dormant', type: 'boolean' },
  status: { flag: '--status', type: 'string' },
  rating: { flag: '--rating', type: 'number' },
  note: { flag: '--note', type: 'string' },
  limit: { flag: '--limit', type: 'number' },
};
const USAGE =
  '使い方: node src/cli/read.js <id> [--status S] [--rating N] [--note T] | node src/cli/read.js --list [--status S] | node src/cli/read.js --dormant [--limit N]';

function parseArgs(argv) {
  const { flags, positional } = parseFlags(argv, SPEC);
  const args = { json: false, list: false, dormant: false, limit: 20, ...flags };
  args.id = positional[0] != null ? Number(positional[0]) : null;
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(resolveDbPath());

  try {
    if (args.dormant) {
      const rows = findDormantBooks(db, { limit: args.limit });
      if (args.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        console.log(`未読のまま蔵書に長くある本（上位${rows.length}件、要約日が古い順）:`);
        console.log('（※要約日を蔵書に加わった時期の目安として使用。実際の取得日とは異なる場合があります）');
        for (const r of rows) {
          console.log(`  [${r.id}] ${r.title} — ${r.author ?? '著者不明'} (要約日: ${r.summarized_at ?? '不明'})`);
        }
      }
      return;
    }

    if (args.list) {
      const rows = listReadingStatus(db, { status: args.status });
      if (args.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        console.log(`読書状態一覧${args.status ? `（status=${args.status}）` : ''}: ${rows.length}件`);
        for (const r of rows) {
          console.log(`  [${r.book_id ?? '?'}] ${r.title ?? r.file_path} — ${r.status}${r.rating ? ` (評価${r.rating})` : ''}`);
        }
      }
      return;
    }

    if (args.id == null) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }

    const filePath = getFilePathForBookId(db, args.id);
    if (!filePath) {
      console.error(`id=${args.id} の本が見つからない、またはfile_pathが無い本（未処理本）です`);
      process.exitCode = 1;
      return;
    }

    if (args.status) {
      const row = setReadingStatus(db, filePath, { status: args.status, rating: args.rating, note: args.note });
      if (args.json) console.log(JSON.stringify(row, null, 2));
      else console.log(`記録しました: [${args.id}] ${filePath} — ${row.status}`);
      return;
    }

    const row = getReadingStatus(db, filePath);
    if (args.json) {
      console.log(JSON.stringify(row ?? null, null, 2));
    } else if (!row) {
      console.log(`[${args.id}] ${filePath} の読書状態は未記録です`);
    } else {
      console.log(`[${args.id}] ${filePath} — ${row.status}${row.rating ? ` (評価${row.rating})` : ''}`);
      if (row.note) console.log(`  メモ: ${row.note}`);
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
