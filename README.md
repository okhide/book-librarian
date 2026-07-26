# book-librarian

蔵書要約データ（約2,500冊のAI生成サマリー）を検索可能なデータベース化し、[Claude Code](https://claude.com/claude-code)上のAI司書スキルが検索・推薦・読書メンタリングを行うためのツールです。

## できること

- ハイブリッド検索: キーワード一致（字面）と意味検索（埋め込みベクトル）を組み合わせ、直接その言葉が出てこない本も候補として提示する
- 読者レベル・正規化トピックでの絞り込み
- 読書状態の記録（読んだ/読書中/中断/未読）と、それを踏まえた推薦・メンタリング
- 蔵書内の重複・近重複本の検出
- k-meansによる蔵書全体の自動クラスタリング（俯瞰）
- ローカルデータだけでは足りない場合、[NotebookLM](https://notebooklm.google.com/)へ本を登録してチャット・クイズ生成による深掘り

すべて、Claude Code上の「司書AI」（`.claude/skills/book-librarian/SKILL.md`）との自然な日本語の対話で操作できます。

## 必要なもの

- Node.js 20以上
- [Claude Code](https://claude.com/claude-code)
- Gemini APIキー（データベースを最初に構築する時のみ。検索・司書機能そのものには不要）
- （任意）[notebooklm-py](https://github.com/teng-lin/notebooklm-py) — NotebookLM連携機能を使う場合のみ
- 蔵書の要約データ（`data/output_data/*.md` 形式。仕様は`doc/03_specification.md`参照）

**PC初心者向けの詳しいセットアップ手順は [`doc/07_user_manual.md`](doc/07_user_manual.md) を参照してください。**

## セットアップ（概要）

```bash
npm install
cp .env.example .env   # GEMINI_API_KEYを設定する
node src/build/build.js   # 蔵書データベースを構築
```

その後、プロジェクトのフォルダで `claude` を起動し、「会計について勉強したい」のように話しかけてください。

## テスト

```bash
npm test          # 単体＋機能試験（数秒〜十数秒）
npm run test:all   # 上記＋結合試験＋性能試験（数分）
```

外部API（Gemini・NotebookLM）は自動テストから一切呼び出しません。テストは`test/fixtures/`の自作データと、実データへの読み取り専用アクセスのみで完結します。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`doc/01_requirements.md`](doc/01_requirements.md) | 要求 |
| [`doc/02_use_cases.md`](doc/02_use_cases.md) | ユースケース |
| [`doc/03_specification.md`](doc/03_specification.md) | 仕様（データ構造・DBスキーマ） |
| [`doc/04_design.md`](doc/04_design.md) | 設計方針・フォルダ構成 |
| [`doc/05_backlog.md`](doc/05_backlog.md) | スコープ外の保留事項 |
| [`doc/06_implementation_plan.md`](doc/06_implementation_plan.md) | 実装計画・開発中の気づきと決定の記録 |
| [`doc/07_user_manual.md`](doc/07_user_manual.md) | ユーザーマニュアル（PC初心者向け） |
| [`doc/08_technical_overview.md`](doc/08_technical_overview.md) | 技術説明（設計のポイント） |

## 注意事項

`data/output_data/`・`data/蔵書リスト.csv`・`data/topic_mapping.json`は、このリポジトリには含まれません（`.gitignore`対象）。これらは元データから生成・取り込む必要があります。詳細は`doc/03_specification.md`の「データソース」および`doc/07_user_manual.md`を参照してください。

## ライセンス

このリポジトリのライセンスは未定です（プライベート/個人利用を前提としています）。
