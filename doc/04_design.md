# 設計方針

## 技術スタック

- ランタイム: Node.js
- DB: SQLite（`better-sqlite3`）。**拡張（FTS5仮想テーブル・sqlite-vec）は使わない。**
- キーワード検索: SQLの `LIKE` によるビルド時合成列（`search_text`）への部分一致
- 意味検索: ローカル埋め込みモデル（`@huggingface/transformers` + `Xenova/multilingual-e5-small`、384次元）でベクトル化し、BLOBで保存してJSで総当たりコサイン類似度
- 正規化メタデータ抽出用LLM: Gemini API（無料ティア）。ビルド時のみ使用。呼び出しはルールベースで判定できない箇所に限定し、数百回程度に抑える
- インターフェース: まずCLI（司書AIがBashツール経由で直接コマンド実行する）。将来的に必要ならMCPサーバー化を検討する。そのため検索ロジックはCLIから独立した共有ライブラリ（`src/lib`）として実装し、CLI／将来のMCPサーバーの両方から呼び出せるようにする。

### 依存パッケージを2つに絞った経緯

当初案では `better-sqlite3` + `sqlite-vec` + 埋め込みライブラリの3つに加えてFTS5の設定が必要だったが、実現性の検証で以下が判明したため簡素化した（詳細は `03_specification.md` の「検索方式の選定」）。

| 当初案 | 問題 | 変更後 |
|---|---|---|
| FTS5で全文検索 | 既定トークナイザ `unicode61` は日本語を分割できず**機能しない**。代替の `trigram` は3文字未満のクエリがマッチしないが、実際の検索語は「会計」「英語」など2文字が主力 | SQLの `LIKE`。11MBの全走査で約100ms。日本語の部分一致が素直に動く |
| `sqlite-vec` でベクトル検索 | 2,527件×384次元＝3.9MBに過ぎず、JSの総当たりで1ms未満。近似最近傍探索は数十万件規模から意味を持つ。ネイティブ拡張のロードはWindowsで不安定になりやすい | ベクトルをBLOB保存し、JSで総当たり |

結果として**ネイティブSQLite拡張への依存がゼロ**になり、日本語トークナイズの問題とインデックス同期の考慮も同時に消えた。1万冊を超えたら再検討する（`05_backlog.md`）。

## 処理の重心配分（重要な設計原則）

ユーザー要求により、**ビルド時には手間をかけてよいが、司書AIの実行時処理はシンプルに保つ**。

| | ビルド時（オフライン・無人実行） | 実行時（司書AIから） |
|---|---|---|
| やること | パース、埋め込み生成、正規化辞書適用、メタデータ抽出 | 検索コマンドを1回叩く／詳細取得コマンドを1回叩く |
| 許容コスト | 数分〜十数分かかってよい | 1コマンドで件数＋候補が返ること |

司書AIが複数コマンドを組み合わせて絞り込みロジックを組む必要がない状態を目指す。絞り込みはCLIのオプションとして提供し、AIは対話に集中する。

## フォルダ構成

> 📝 以下は開発着手前に立てた**当初案**（この節の元の内容）ではなく、実装完了時点（v1.0.0）の
> 実際の構成に更新したもの。当初案からの主な変更点は、ファイル単位がより細かく分かれたこと
> （例: `build/topics.js`という1ファイル構想は、実際には`topicVocab.js`/`topicTaxonomyDraft.js`/
> `topicMapping.js`/`applyTopics.js`＋各`run*.js`実行スクリプトに分かれた）と、
> Phase 6・7で`src/bridge/notebooklm/`・重複検知・クラスタリングが追加されたこと。

```
20260725_book_librarian/
  data/
    output_data/           # ジャンクション → 元プロジェクトのoutput_data （読み取り専用）
    蔵書リスト.csv           # build.js実行のたびに元プロジェクトのCSVから自動コピーされるキャッシュ（読み取り専用）
    topic_taxonomy.json    # トピック分類表（可変・2026-07-27時点で40項目）★ユーザーが手編集する・git管理対象
    topic_overrides.json   # keyword→topicの例外指定 ★ユーザーが手編集する・git管理対象
    topic_mapping.json     # keyword→topic対応表（約8,780件）自動生成物・.gitignore対象
    db/
      library.db           # 生成物（.gitignore対象）
    models/                # ダウンロードした埋め込みモデルのキャッシュ（.gitignore対象）
  src/
    build/                 # DB構築・差分更新・トピック/reader_level分類スクリプト
      parse.js / persist.js / fullBuild.js / fullRebuild.js / diffUpdate.js
      csv.js / reconcileCsv.js         # 蔵書リスト.csvの取り込み・突き合わせ
      embedBuild.js                    # 埋め込み生成
      topicVocab.js / topicTaxonomyDraft.js / topicMapping.js / applyTopics.js
      readerLevel.js / readerLevelLlm.js
      build.js                         # メインの実行スクリプト（初回/差分/フルリビルド）
      run{TaxonomyDraft,TopicMapping,ApplyTopics,ReaderLevelLlm}.js  # 個別実行用スクリプト
    lib/                   # 共有ライブラリ（CLI/将来のMCP双方から利用）
      schema.js / hash.js / text.js / vectorBlob.js
      keywordSearch.js / vectorSearch.js / hybridSearch.js / bookFilters.js
      embed.js / gemini.js / bulkSummary.js / stats.js / readingStatus.js
      duplicateDetection.js / clustering.js
    cli/                   # CLIコマンド
      dbPath.js / argParse.js（共通ヘルパー）
      search.js / show.js / similar.js / topics.js / stats.js / read.js
      duplicates.js / notebooklm.js
    bridge/
      notebooklm/          # NotebookLM橋渡しアダプタ（cli.js / adapter.js / booksCsv.js）
    librarian/             # 司書AIのペルソナ定義・プロンプト・スキル定義（正本）
                           # .claude/skills/book-librarian/SKILL.md に同一内容のコピーを
                           # 置く必要がある（Claude Codeが実際にスキルとして発見・起動する
                           # のはこちらのパスのため）。test/unit/skillDoc.test.js で
                           # 両者の一致を検証している
  doc/
    01_requirements.md / 02_use_cases.md / 03_specification.md / 04_design.md
    05_backlog.md / 06_implementation_plan.md
    07_user_manual.md      # PC初心者向けユーザーマニュアル
    08_technical_overview.md  # 技術説明（設計のポイント）
  spike/                   # 事前検証スクリプト（本体へは移植しない。決定の根拠として残す）
  test/                    # unit / functional / integration / performance
  CLAUDE.md
  .gitignore
```

**`data/` のgit管理方針について注意:** 当初「`data/` はまるごと `.gitignore` 対象」としていたが、`topic_taxonomy.json` と `topic_overrides.json` は**ユーザーが手で作り込む資産**であり、失うと作り直しのコストが高い。この2ファイルはgit管理対象に含める（`.gitignore` で例外指定する）。`library.db`・`topic_mapping.json`・`models/` は再生成可能なため除外する。

## 開発手順（フェーズ分け）

各フェーズは**それ単体で価値が出る**ところで区切っている。Phase 2が終われば司書AIなしでも検索ツールとして使え、Phase 3で司書として振る舞い始める。

### Phase 1: DB構築基盤（検索なし・データが正しく入ることに集中）

- `output_data/*.md` のパーサー（フロントマター＋本文抽出）
  - 「1. 初期要約」→ `summary_long`、「2. 詳細要約」→ `summary_short` にマップする（**見出し名と実際の長さが逆**なので注意）
  - ファイル名に `[` `]` を含む56件があるため、リテラルパスで走査する（globライブラリに渡さない）
- `蔵書リスト.csv` の読み込みと突き合わせ（`status='pending'` 行の生成）
- フルビルド・差分更新の両対応スクリプト
  - 変更検知は `file_mtime` を一次フィルタ、`content_hash` で確定判定する二段構え
  - 1冊の更新は「関連テーブルの旧行を削除してから再挿入」＋`search_text` の再合成を1トランザクションで行う
  - 本ごとにコミットして冪等性を確保し、中断後の再実行で続行できるようにする
  - フルリビルドが `reading_status` を消さないことをテストで検証する
- **完了条件**: 2,527冊すべてがDBに入り、差分更新を2回連続実行しても結果が変わらない（冪等）

### Phase 2: 検索CLI（ここで単体のツールとして使える状態になる）

- ローカル埋め込みモデルの導入と全2,527冊の埋め込み生成（1冊1ベクトル、チャンク分割なし）
  - E5系モデルの接頭辞（`passage:` / `query:`）の付け分けに注意
- `src/lib` にハイブリッド検索を実装（`LIKE` ＋ ベクトル総当たり ＋ 構造化絞り込み）
- CLIコマンド: `search` / `show` / `similar`
  - `search` は出力に**総ヒット件数**を必ず含める
  - `show` は `summary_long` を無加工で全文出力する
  - `similar` は埋め込みの副産物なので追加コストなしで実装できる
- **完了条件**: 「会計」「ルネサンスの食文化」等で妥当な結果が返り、ランキングの重みが実データで調整済み

### Phase 3: トピック分類とメタデータ（絞り込み軸の獲得）

- 頻出キーワード248語からLLMで**トピック分類表の草案**を作り、ユーザーがレビュー・編集する
- 確定した分類表で8,780語の対応表を生成（LLM約60回）→ `topic_mapping.json`
- `reader_level` のルールベース判定＋判定不能分のみLLM
- CLIコマンド: `topics` / `stats`
- **完了条件**: `--topic` `--level` での絞り込みが機能し、ユーザーが分類表を納得して受け入れている

### Phase 4: 司書AIペルソナ

- `src/librarian` にシステムプロンプト・スキル定義（Claude Code Skillとして `SKILL.md` 化）
- ローカルDB検索→**ヒット件数の提示**→絞り込み提案→対話で絞り込み→回答、までのフローを実装
- `search --with-summary` を使った複数冊横断の統合回答

### Phase 5: 読書状態とメンタリング

- `reading_status` テーブルと `read` コマンド
- 未読からの推薦、死蔵本の掘り起こし、進捗を踏まえた提案を司書スキルに組み込む
- **フルリビルドでユーザーデータが消えないことを再確認する**

### Phase 6: NotebookLM橋渡し

- 既存notebooklmスキルを利用したアダプタ実装
- 本の登録・ask・generateの一連の操作をlibrarianスキルから呼び出せるようにする

### Phase 7: 発展機能（余力に応じて）

- 重複・近重複検知（全ペア類似度。約320万回の計算で数秒）
- 蔵書クラスタリングによる俯瞰（k-means）

### Phase 8（バックログ）

`doc/05_backlog.md` を参照。

## 開発開始時のチェックリスト（次セッション向け）

- `npm init` 及び必要なパッケージの選定・導入
  - `better-sqlite3`（SQLite。**拡張のロードは不要になった**）
  - `@huggingface/transformers`（ローカル埋め込み。日本語モデルの選定を含む）
  - CSVパーサー
- `data/output_data` ジャンクション経由でのファイル読み込み動作確認（Windows環境ではジャンクション越しのファイルアクセスは通常問題ないが、念のため最初に確認する）
- ファイル名に `[` `]` を含む56件が正しく読めることを最初に確認する（リテラルパス指定の検証）
- このプロジェクト用に `git init` するかどうかをユーザーに確認する
- `蔵書リスト.csv`（2,528行）と `output_data`（2,527ファイル）の件数差など、突き合わせ時に想定される差異（未処理本・処理失敗本の存在）を把握しておく
- 要約セクションのパース漏れ確認: 調査時、2,527ファイル中2,471件で両セクションを抽出できた。残り56件は上記の `[` `]` 問題によるものと思われるが、パーサー実装時に**全2,527件から抽出できることを検証する**（見出し表記が異なる例外ファイルがないかの確認も兼ねる）
- `LIKE` 検索の実測: 2,527行・約11MBに対する `LIKE '%語%'` の所要時間を実際に測り、想定（約100ms）と合っているか確認する。大きく外れる場合はPhase 2で方式を再検討する
- 埋め込みモデルの選定と実測: 日本語での類似度品質、モデルのダウンロードサイズ、CLI起動時のモデルロード時間（想定1〜3秒）を確認する
