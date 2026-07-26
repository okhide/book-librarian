// Step 6.2の手動確認用スクリプト。実際のnotebooklm CLIを呼び、
// src/bridge/notebooklm/{cli,adapter}.js の本番コードパスを実データで検証する。
// 単一プロセス内で完結させ、シェル変数の受け渡しミスによる事故（実際に発生した）を避ける。
// 使い方: node spike/notebooklmManualCheck.mjs [--cleanup]
import { createNotebookLmCli } from '../src/bridge/notebooklm/cli.js';
import { createNotebookLmAdapter } from '../src/bridge/notebooklm/adapter.js';

const books = [
  { id: 333, title: 'お役所のことばがわかる本（予算・財務・会計編）： 知らない 訊けない 聞いてもわからない ことば', drive_url: 'https://drive.google.com/file/d/1je3Fyg-KNwECIjJbmY4s5upkNXul07Db/view?usp=drivesdk' },
  { id: 620, title: 'エンジニアが学ぶ 会計システムの 知識と技術', drive_url: 'https://drive.google.com/file/d/16en9pDxj0NJVzAaS6QVi8SzBMYPRain3/view?usp=drivesdk' },
  { id: 700, title: 'サクッとわかるビジネス教養 会計学', drive_url: 'https://drive.google.com/file/d/1qHk-4d2aZgN6QXWwxi8X28tgWao7BVy7/view?usp=drivesdk' },
];

const cli = createNotebookLmCli();
const adapter = createNotebookLmAdapter(cli);

const result = await adapter.registerBooks({ theme: '会計', books });
console.log('=== registerBooks結果 ===');
console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exit(1);

console.log(`\n=== ノートブックID（削除する場合はこのIDのみを対象にすること）: ${result.notebook.id} ===`);

if (process.argv.includes('--cleanup')) {
  console.log('\n=== finalize（削除）実行 ===');
  const finalizeResult = await adapter.finalize(result.notebook, { created: result.created, keep: false });
  console.log(JSON.stringify(finalizeResult, null, 2));
}
