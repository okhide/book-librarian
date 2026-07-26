#!/usr/bin/env node
// Obsidian Vaultへのノート書き出し（doc/06_implementation_plan.md Phase 8）。
// ノートの本文構成・マージ判断はChat内でClaudeが行う。このCLIは
// ファイル名生成・既存ノート一覧取得・決定的な書き込みのみを担う。
//
// Vaultパスは.envのOBSIDIAN_VAULT_PATHで指定する。書き出し先はVault直下ではなく
// サブフォルダ（既定"book-librarian"）で、.envのOBSIDIAN_NOTES_SUBDIRで変更できる
// （空文字を指定するとVault直下になる）。list/writeともにこのサブフォルダを対象にする。
//
// 使い方:
//   node src/cli/obsidian.js filename --topic "<トピック名>" [--date YYYY-MM-DD] [--json]
//   node src/cli/obsidian.js list [--query "<検索語>"] [--json]
//   node src/cli/obsidian.js write --spec-file <path> [--mode create|overwrite] [--json]
//
// filenameはYYYYMMDD_トピック名.md形式で生成される（例: 20260726_資本論の労働価値説.md）。
//
// --spec-file が指すJSONの形:
//   {
//     "topic": "資本論の労働価値説",
//     "date": "2026-07-26",           // 省略可（今日の日付）
//     "tags": ["book", "経済学"],       // 省略可
//     "book": { "title": "...", "author": "...", "isbn": "..." }, // 省略可
//     "notebooklmSources": [{ "id": "...", "title": "..." }],      // 省略可
//     "body": "# 見出し\n本文..."
//   }
process.loadEnvFile('.env');

import fs from 'node:fs';
import { parseFlags } from './argParse.js';
import { getNotesDir } from '../bridge/obsidian/config.js';
import { buildFilename } from '../bridge/obsidian/filename.js';
import { buildFrontmatter } from '../bridge/obsidian/frontmatter.js';
import { listNotes, writeNote } from '../bridge/obsidian/vault.js';

const SPEC = {
  json: { flag: '--json', type: 'boolean' },
  topic: { flag: '--topic', type: 'string' },
  date: { flag: '--date', type: 'string' },
  query: { flag: '--query', type: 'string' },
  specFile: { flag: '--spec-file', type: 'string' },
  mode: { flag: '--mode', type: 'string' },
};

const USAGE = [
  '使い方:',
  '  node src/cli/obsidian.js filename --topic "<トピック名>" [--date YYYY-MM-DD] [--json]',
  '  node src/cli/obsidian.js list [--query "<検索語>"] [--json]',
  '  node src/cli/obsidian.js write --spec-file <path> [--mode create|overwrite] [--json]',
].join('\n');

function parseArgs(argv) {
  const { flags, positional } = parseFlags(argv, SPEC);
  const args = { json: false, mode: 'create', ...flags };
  args.command = positional[0];
  return args;
}

function runFilename(args) {
  if (!args.topic) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const filename = buildFilename({ topic: args.topic, date: args.date });
  if (args.json) console.log(JSON.stringify({ filename }, null, 2));
  else console.log(filename);
}

function runList(args) {
  const notesDir = getNotesDir();
  const notes = listNotes(notesDir, { query: args.query });
  if (args.json) {
    console.log(JSON.stringify({ notes }, null, 2));
  } else if (notes.length === 0) {
    console.log('該当するノートはありません');
  } else {
    console.log(`${notes.length}件見つかりました:`);
    for (const n of notes) console.log(`  ${n}`);
  }
}

function runWrite(args) {
  if (!args.specFile) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const spec = JSON.parse(fs.readFileSync(args.specFile, 'utf8'));
  if (!spec.topic || !spec.body) {
    throw new Error('specFileには topic と body が必須です');
  }

  const notesDir = getNotesDir();
  const filename = buildFilename({ topic: spec.topic, date: spec.date });
  const frontmatter = buildFrontmatter({
    title: spec.topic,
    createdAt: spec.date,
    tags: spec.tags,
    book: spec.book,
    notebooklmSources: spec.notebooklmSources,
  });
  const content = `${frontmatter}\n${spec.body}\n`;
  const fullPath = writeNote(notesDir, filename, content, { mode: args.mode });

  if (args.json) console.log(JSON.stringify({ filename, path: fullPath }, null, 2));
  else console.log(`書き込みました: ${fullPath}`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'filename') runFilename(args);
  else if (args.command === 'list') runList(args);
  else if (args.command === 'write') runWrite(args);
  else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
