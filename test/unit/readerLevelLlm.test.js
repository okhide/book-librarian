// classifyBatchFnを注入してテストする。Gemini APIは呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import { classifyReaderLevelBatch, generateReaderLevelsForUnclassified, buildReaderLevelPrompt } from '../../src/build/readerLevelLlm.js';

test('buildReaderLevelPrompt: idと書名がプロンプトに含まれる', () => {
  const prompt = buildReaderLevelPrompt([{ id: 1, title: '会計の考え方', keywords: ['会計'], summaryShort: '要約' }]);
  assert.match(prompt, /id=1/);
  assert.match(prompt, /会計の考え方/);
});

test('classifyReaderLevelBatch: 有効なlevelはそのまま採用される', async () => {
  const fakeGenerate = async () => ({ classifications: [{ id: 1, level: 'advanced' }] });
  const { levels, invalidCount } = await classifyReaderLevelBatch(
    [{ id: 1, title: 'x', keywords: [], summaryShort: '' }],
    fakeGenerate
  );
  assert.equal(levels.get(1), 'advanced');
  assert.equal(invalidCount, 0);
});

test('classifyReaderLevelBatch: 無効なlevel文字列はnullとして検知される', async () => {
  const fakeGenerate = async () => ({ classifications: [{ id: 1, level: 'super-advanced' }] });
  const { levels, invalidCount } = await classifyReaderLevelBatch(
    [{ id: 1, title: 'x', keywords: [], summaryShort: '' }],
    fakeGenerate
  );
  assert.equal(levels.get(1), null);
  assert.equal(invalidCount, 1);
});

test('classifyReaderLevelBatch: 応答から省略されたidはnullで補完される', async () => {
  const fakeGenerate = async () => ({ classifications: [] });
  const { levels, invalidCount } = await classifyReaderLevelBatch(
    [{ id: 1, title: 'x', keywords: [], summaryShort: '' }],
    fakeGenerate
  );
  assert.equal(levels.get(1), null);
  assert.equal(invalidCount, 1);
});

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function insertBook(db, title) {
  return db
    .prepare(
      "INSERT INTO books (status, title, title_is_fallback, summary_short, updated_at) VALUES ('summarized', ?, 0, 's', '2026-01-01')"
    )
    .run(title).lastInsertRowid;
}

test('generateReaderLevelsForUnclassified: 未判定の本だけが対象になり、DBが更新される', async () => {
  const db = makeDb();
  const id1 = insertBook(db, '会計の考え方');
  db.prepare("UPDATE books SET reader_level='beginner', reader_level_source='rule' WHERE id=?").run(
    insertBook(db, 'Python入門')
  );

  const classifyBatchFn = async (batch) => {
    assert.equal(batch.length, 1); // ルール判定済みの本は対象に含まれない
    assert.equal(batch[0].id, id1);
    return { levels: new Map([[id1, 'intermediate']]), invalidCount: 0 };
  };

  const summary = await generateReaderLevelsForUnclassified(db, { classifyBatchFn });
  assert.equal(summary.totalBooks, 1);

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id1);
  assert.equal(book.reader_level, 'intermediate');
  assert.equal(book.reader_level_source, 'llm');
  db.close();
});

test('generateReaderLevelsForUnclassified: levelがnullの本は更新されず、未判定のまま残る（次回再試行できる）', async () => {
  const db = makeDb();
  const id1 = insertBook(db, '謎の本');

  const classifyBatchFn = async () => ({ levels: new Map([[id1, null]]), invalidCount: 1 });
  await generateReaderLevelsForUnclassified(db, { classifyBatchFn });

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id1);
  assert.equal(book.reader_level, null);
  assert.equal(book.reader_level_source, null);
  db.close();
});

test('generateReaderLevelsForUnclassified: バッチサイズに応じて分割される', async () => {
  const db = makeDb();
  const ids = [insertBook(db, 'A'), insertBook(db, 'B'), insertBook(db, 'C')];
  const batchesSeen = [];

  const classifyBatchFn = async (batch) => {
    batchesSeen.push(batch.map((b) => b.id));
    const levels = new Map(batch.map((b) => [b.id, 'intermediate']));
    return { levels, invalidCount: 0 };
  };

  const summary = await generateReaderLevelsForUnclassified(db, { classifyBatchFn, batchSize: 2 });
  assert.equal(summary.batchesProcessed, 2);
  assert.deepEqual(batchesSeen, [[ids[0], ids[1]], [ids[2]]]);
  db.close();
});
