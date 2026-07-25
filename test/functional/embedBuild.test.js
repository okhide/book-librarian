// 実際の埋め込みモデルをロードするため、unitではなくfunctionalに置く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { insertBook, updateBook, getBookByFilePath } from '../../src/build/persist.js';
import { parseBookMarkdown } from '../../src/build/parse.js';
import { findBooksNeedingEmbedding, generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder, EMBEDDING_DIM } from '../../src/lib/embed.js';
import { blobToFloatArray } from '../../src/lib/vectorBlob.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

test('埋め込み生成・保存', async (t) => {
  const extractor = await createEmbedder();

  await t.test('summarized本のうち埋め込みが無い本が全件検出される', () => {
    const db = new Database(':memory:');
    initSchema(db);
    runFullBuild(db, FIXTURES_OUTPUT_DATA); // 6件のsummarized本

    const candidates = findBooksNeedingEmbedding(db);
    assert.equal(candidates.length, 6);
    db.close();
  });

  await t.test('生成した埋め込みがbook_embeddingsに正しく保存され、往復できる', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    runFullBuild(db, FIXTURES_OUTPUT_DATA);

    const { generated, total } = await generateMissingEmbeddings(db, extractor);
    assert.equal(generated, 6);
    assert.equal(total, 6);

    const rows = db.prepare('SELECT * FROM book_embeddings').all();
    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.equal(row.dim, EMBEDDING_DIM);
      const vec = blobToFloatArray(row.embedding);
      assert.equal(vec.length, EMBEDDING_DIM);
      const norm = Math.sqrt(dot(vec, vec));
      assert.ok(Math.abs(norm - 1) < 1e-3, `ノルムが1から離れている: ${norm}`);
    }

    db.close();
  });

  await t.test('2回目の実行では新規生成が0件になる（冪等）', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    runFullBuild(db, FIXTURES_OUTPUT_DATA);

    await generateMissingEmbeddings(db, extractor);
    const second = await generateMissingEmbeddings(db, extractor);
    assert.equal(second.generated, 0);
    assert.equal(second.total, 0);

    db.close();
  });

  await t.test('embed_source_hashが変わらない更新では既存の埋め込みが温存される', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    runFullBuild(db, FIXTURES_OUTPUT_DATA);
    await generateMissingEmbeddings(db, extractor);

    const before = getBookByFilePath(db, 'normal_book.md');
    const beforeEmbedding = db.prepare('SELECT * FROM book_embeddings WHERE book_id = ?').get(before.id);
    assert.ok(beforeEmbedding != null);

    // reliabilityだけ変える(埋め込み対象テキストには影響しないフィールド)
    const rawText = `---
title: "テスト用の会計入門book"
author: "山田太郎"
publisher: "テスト出版"
series: "テスト新書"
edition: "初版"
isbn: "9784000000001"
publication_date: "2020年6月19日"
keywords: ["会計", "簿記", "決算", "財務", "経営"]
category: "実用書"
reliability: 1
url: "https://drive.google.com/file/d/dummy1/view"
date: "2026-07-09"
---

# 1. 画面右側から取得した初期要約
これはテスト用の長い要約である。会計の基本的な考え方について、簿記の仕組みから決算書の読み方まで幅広く解説している。

**重要なポイント**

  * 会計の目的は経営状態を正しく把握することである。
  * 簿記は日々の取引を記録する技術である。

# 2. プロンプト回答（詳細要約）
会計の基本を解説したテスト用の短い要約である。

\`\`\`json
{}
\`\`\`
`;
    const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
    assert.equal(parsed.ok, true);
    updateBook(db, before.id, {
      filePath: 'normal_book.md',
      fileMtime: 'dummy-mtime-2',
      contentHash: 'dummy-hash-2',
      parsed: parsed.data,
    });

    const afterEmbedding = db.prepare('SELECT * FROM book_embeddings WHERE book_id = ?').get(before.id);
    assert.ok(afterEmbedding != null, 'reliabilityのみの変更で埋め込みが消えてしまった');
    assert.deepEqual(afterEmbedding.embedding, beforeEmbedding.embedding);

    const stillNeeded = findBooksNeedingEmbedding(db);
    assert.equal(stillNeeded.length, 0);

    db.close();
  });

  await t.test('keywordsが変わる更新ではembed_source_hashが変わり、埋め込みが再生成対象になる', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    runFullBuild(db, FIXTURES_OUTPUT_DATA);
    await generateMissingEmbeddings(db, extractor);

    const before = getBookByFilePath(db, 'normal_book.md');

    const rawText = `---
title: "テスト用の会計入門book"
author: "山田太郎"
publisher: "テスト出版"
series: "テスト新書"
edition: "初版"
isbn: "9784000000001"
publication_date: "2020年6月19日"
keywords: ["投資", "資産運用"]
category: "実用書"
reliability: 3
url: "https://drive.google.com/file/d/dummy1/view"
date: "2026-07-09"
---

# 1. 画面右側から取得した初期要約
これはテスト用の長い要約である。会計の基本的な考え方について、簿記の仕組みから決算書の読み方まで幅広く解説している。

**重要なポイント**

  * 会計の目的は経営状態を正しく把握することである。
  * 簿記は日々の取引を記録する技術である。

# 2. プロンプト回答（詳細要約）
会計の基本を解説したテスト用の短い要約である。

\`\`\`json
{}
\`\`\`
`;
    const parsed = parseBookMarkdown(rawText, { fileName: 'normal_book.md' });
    updateBook(db, before.id, {
      filePath: 'normal_book.md',
      fileMtime: 'dummy-mtime-3',
      contentHash: 'dummy-hash-3',
      parsed: parsed.data,
    });

    const afterEmbedding = db.prepare('SELECT * FROM book_embeddings WHERE book_id = ?').get(before.id);
    assert.equal(afterEmbedding, undefined, 'keywords変更後も古い埋め込みが残っている');

    const needed = findBooksNeedingEmbedding(db);
    assert.equal(needed.length, 1);
    assert.equal(needed[0].id, before.id);

    db.close();
  });
});
