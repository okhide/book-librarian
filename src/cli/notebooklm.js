#!/usr/bin/env node
// 使い方:
//   node src/cli/notebooklm.js register --theme "<テーマ名>" --ids 1,2,3 [--json]
//   node src/cli/notebooklm.js ask --notebook <id> "<質問>" [--json]
//   node src/cli/notebooklm.js quiz --notebook <id> [--quantity fewer|standard|more] [--difficulty easy|medium|hard] [--json]
//   node src/cli/notebooklm.js finalize --notebook <id> --title "<title>" --created <true|false> --keep <true|false> [--json]
//
// registerが返すnotebook.id/notebook.title/createdは、後でfinalizeを呼ぶ際に
// 呼び出し側（司書スキル）が会話の中で覚えておき、そのまま渡すこと
// （このCLIはプロセスをまたいだ状態を持たない）。
import Database from 'better-sqlite3';
import { resolveDbPath } from './dbPath.js';
import { parseFlags } from './argParse.js';
import { createNotebookLmCli } from '../bridge/notebooklm/cli.js';
import { createNotebookLmAdapter } from '../bridge/notebooklm/adapter.js';

const SPEC = {
  json: { flag: '--json', type: 'boolean' },
  theme: { flag: '--theme', type: 'string' },
  ids: { flag: '--ids', type: 'numberList' },
  notebook: { flag: '--notebook', type: 'string' },
  title: { flag: '--title', type: 'string' },
  created: { flag: '--created', type: 'string' },
  keep: { flag: '--keep', type: 'string' },
  quantity: { flag: '--quantity', type: 'string' },
  difficulty: { flag: '--difficulty', type: 'string' },
};

function parseArgs(argv) {
  const { flags, positional } = parseFlags(argv, SPEC);
  const args = { json: false, ids: [], ...flags };
  // --created/--keepは"true"/"false"の文字列で渡される（真偽値そのものではない）ため、
  // 未指定(undefined)とfalseを区別できるようここで変換する
  if (args.created !== undefined) args.created = args.created === 'true';
  if (args.keep !== undefined) args.keep = args.keep === 'true';
  args.command = positional[0];
  args.text = positional[1];
  return args;
}

const USAGE = [
  '使い方:',
  '  node src/cli/notebooklm.js register --theme "<テーマ名>" --ids 1,2,3 [--json]',
  '  node src/cli/notebooklm.js ask --notebook <id> "<質問>" [--json]',
  '  node src/cli/notebooklm.js quiz --notebook <id> [--quantity fewer|standard|more] [--difficulty easy|medium|hard] [--json]',
  '  node src/cli/notebooklm.js finalize --notebook <id> --title "<title>" --created <true|false> --keep <true|false> [--json]',
].join('\n');

const adapter = createNotebookLmAdapter(createNotebookLmCli());

async function runRegister(args) {
  if (!args.theme || args.ids.length === 0) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const db = new Database(resolveDbPath(), { readonly: true });
  const placeholders = args.ids.map(() => '?').join(',');
  const books = db.prepare(`SELECT id, title, drive_url FROM books WHERE id IN (${placeholders})`).all(...args.ids);
  db.close();

  const result = await adapter.registerBooks({ theme: args.theme, books });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.ok) {
    console.log(result.message);
  } else {
    console.log(
      `ノートブック「${result.notebook.title}」（id: ${result.notebook.id}, ${result.created ? '新規作成' : '既存を再利用'}）`
    );
    for (const r of result.results) {
      const label = { added: '登録', skipped: 'スキップ', error: '失敗' }[r.status] ?? r.status;
      console.log(`  [${label}] ${r.book.title}${r.reason ? ` — ${r.reason}` : ''}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

async function runAsk(args) {
  if (!args.notebook || !args.text) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const result = await adapter.ask(args.notebook, args.text);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(result.answer);
}

async function runQuiz(args) {
  if (!args.notebook) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const result = await adapter.generateQuiz(args.notebook, { quantity: args.quantity, difficulty: args.difficulty });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`クイズ生成: ${result.status}（task_id: ${result.task_id}）`);
}

async function runFinalize(args) {
  if (!args.notebook || !args.title || args.created == null || args.keep == null) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const result = await adapter.finalize(
    { id: args.notebook, title: args.title },
    { created: args.created, keep: args.keep }
  );
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(result.deleted ? '削除しました' : `削除しませんでした（${result.reason ?? ''}）`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'register') await runRegister(args);
  else if (args.command === 'ask') await runAsk(args);
  else if (args.command === 'quiz') await runQuiz(args);
  else if (args.command === 'finalize') await runFinalize(args);
  else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
