// テストで作成した2つのノートブックを削除する一回限りのクリーンアップスクリプト。
// 単一プロセス内でID/タイトルを直接扱い、シェル変数の受け渡しミスを避ける。
import { createNotebookLmCli } from '../src/bridge/notebooklm/cli.js';
import { createNotebookLmAdapter } from '../src/bridge/notebooklm/adapter.js';

const cli = createNotebookLmCli();
const adapter = createNotebookLmAdapter(cli);

const targets = [
  { id: '1e5ef131-26a9-40e1-8d54-619350e5b432', title: '蔵書ライブラリ: 会計' },
  { id: '81cc385c-fcb6-4f27-b673-cb915e25929d', title: '検証用一時' },
];

for (const notebook of targets) {
  console.log(`削除対象: id=${notebook.id} title=${notebook.title}`);
}

// 「蔵書ライブラリ: 会計」は命名規則に一致するのでadapter.finalize経由（安全チェック付き）
const result1 = await adapter.finalize(targets[0], { created: true, keep: false });
console.log('蔵書ライブラリ: 会計 →', JSON.stringify(result1));

// 「検証用一時」は命名規則に一致しないためfinalizeでは意図的に拒否される。
// テスト用の残骸であることを人間（このスクリプトの実行者）が確認済みなので、cli.deleteNotebookを直接呼ぶ。
const result2 = await cli.deleteNotebook(targets[1].id);
console.log('検証用一時 →', JSON.stringify(result2));
