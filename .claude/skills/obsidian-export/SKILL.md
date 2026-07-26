---
name: obsidian-export
description: チャットで調べた内容や、NotebookLMでの深掘り・まとめ結果をObsidian Vaultにノートとして書き出す。「これについてさらに調べてObsidianに出力して」「今の内容をObsidianにまとめて」「このノートをObsidianに保存して」等の依頼で使う。
---

# Obsidian書き出し

あなたはチャットでの調査・議論の内容を、Obsidian Vaultの学習ノートとして
整理して書き出す役割を担います（`doc/06_implementation_plan.md` Phase 8参照）。

ノートの本文構成や、マージするか別名保存するかの判断はあなた自身が行います。
このスキルが使うCLI（`src/cli/obsidian.js`）は、ファイル名生成・既存ノート一覧取得・
決定的な書き込みのみを行う薄いヘルパーです。

## 想定する2つの使い方

1. **チャット調査内容の書き出し**: 「これらについて、xxをさらに調べ、ooという構成に
   したうえで、Obsidianに出力してください」と依頼された場合。指定があれば追加調査
   （Web検索等）を行い、指定された構成（見出し立て等）で本文を作成する。
2. **NotebookLM深掘り結果の書き出し**: NotebookLMにソースを登録し、「作者の主張と
   実践手順をまとめて」等のプロンプトで深掘り・まとめをした結果をチャットに表示した
   あと、それをObsidianに出力する場合。ソースが複数になることがある
   （`node src/cli/notebooklm.js register`の結果から得た`id`/`title`を使う）。

いずれの場合も、**実際にチャットで調査・議論した内容を反映すること。** 存在しない
情報（書誌情報・ISBN等）を捏造せず、不明なものは省略する。

## 書き出しの手順

1. **トピック名を決める**: ノートのタイトル・ファイル名の元になる短い名前。
   ユーザーの依頼から明確でなければ確認する。
2. **本文を作成する**: 指定された構成（無指定なら内容に応じて見出しを立てる）で、
   実際の調査・議論内容をMarkdown本文としてまとめる。
3. **既存ノートを確認する**: `node src/cli/obsidian.js list --query "<トピック名>"`
   で類似ノートが無いか確認する。
   - 見つかった場合、**必ず**ユーザーに一覧を見せ、「マージしますか？別名で保存
     しますか？」と毎回確認する（自動判断しない）。
   - 見つからなければそのまま新規作成でよい。
4. **specファイルを作る**: プロジェクトディレクトリの外にある自分のスクラッチパッド用
   ディレクトリにJSONを書く（プロジェクト内に一時ファイルを作らない）。

   ```json
   {
     "topic": "資本論の労働価値説",
     "date": "2026-07-26",
     "tags": ["book", "経済学"],
     "book": { "title": "資本論", "author": "カール・マルクス", "isbn": "..." },
     "notebooklmSources": [{ "id": "abc123", "title": "資本論 第一巻" }],
     "body": "# 見出し\n本文..."
   }
   ```

   - `book`はこの調査が特定の本に関わる場合のみ含める（`title`/`author`/`isbn`は
     わかる範囲でよい、全て省略可）。書誌情報は`search`/`show`（book-librarianスキル）
     で取得したものを使い、推測で埋めない。
   - `notebooklmSources`はNotebookLM経由の場合のみ含める。
   - `date`を省略すると今日の日付が使われる。
5. **書き込む**:
   - 新規作成、または別名保存の場合: `--mode`省略（既定`create`）。
   - マージの場合: **既存ノートと同じファイル名**を`topic`/`date`から再現するか、
     `list`で得たファイル名を使い、既存ノートの内容を読み込んだうえで統合した
     本文を`body`にし、`--mode overwrite`で上書きする。
6. 実行:

   ```
   node src/cli/obsidian.js write --spec-file <path> --json
   ```

   結果の`path`をユーザーに伝える。

## CLIコマンド一覧

Vaultパスは`.env`の`OBSIDIAN_VAULT_PATH`で設定されている前提。書き出し先は
Vault内のサブフォルダ（既定`book-librarian`、`.env`の`OBSIDIAN_NOTES_SUBDIR`で
変更可）。`OBSIDIAN_VAULT_PATH`が未設定の場合はエラーになるので、その旨を伝え
`.env`への設定を案内する（このプロジェクトはVaultパス等の秘密性のある設定を
`.env`で管理する方針のため、代行して書き込むことはできない）。

### `filename` — ファイル名のプレビュー

```
node src/cli/obsidian.js filename --topic "<トピック名>" [--date YYYY-MM-DD] [--json]
```

`YYYYMMDD_トピック名.md`形式で生成される（例: `20260726_資本論の労働価値説.md`）。

### `list` — 既存ノート一覧・検索

```
node src/cli/obsidian.js list [--query "<検索語>"] [--json]
```

`--query`省略時は全ノートを列挙。指定時はファイル名の部分一致で絞り込む
（重複候補の確認に使う）。

### `write` — ノートを書き込む

```
node src/cli/obsidian.js write --spec-file <path> [--mode create|overwrite] [--json]
```

`--mode create`（既定）は既存ファイルへの書き込みを拒否する（意図しない上書き防止）。
マージ・更新には`--mode overwrite`を明示的に指定する。

## 避けるべき振る舞い

- 既存ノートの確認（`list`）をせずにいきなり書き込まない。
- マージか別名保存かを自動判断せず、必ずユーザーに確認する。
- 実際の調査・議論内容と無関係な、機械的なテンプレート本文で済ませない。
- 書誌情報・NotebookLMソース等を推測で捏造しない（不明なら省略する）。
- `OBSIDIAN_VAULT_PATH`未設定のエラーを黙って諦めず、`.env`への設定方法を案内する。
