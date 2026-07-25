import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../../src/lib/schema.js';
import { classifyReaderLevelByRule, applyReaderLevelRules } from '../../src/build/readerLevel.js';

test('classifyReaderLevelByRule: 初心者シグナルを検知する', () => {
  assert.equal(classifyReaderLevelByRule('Python入門'), 'beginner');
  assert.equal(classifyReaderLevelByRule('ゼロからはじめるReact'), 'beginner');
  assert.equal(classifyReaderLevelByRule('図解でわかる会計'), 'beginner');
});

test('classifyReaderLevelByRule: 上級シグナルを検知する', () => {
  assert.equal(classifyReaderLevelByRule('Kubernetes詳解'), 'advanced');
  assert.equal(classifyReaderLevelByRule('上級者のための統計学'), 'advanced');
});

test('classifyReaderLevelByRule: 両方に一致する場合は初心者を優先する', () => {
  // 「完全入門」のような、強い初心者シグナルを弱い上級語が修飾しているだけのケース
  assert.equal(classifyReaderLevelByRule('Docker完全入門 実務で使える基礎知識'), 'beginner');
});

test('classifyReaderLevelByRule: どちらにも一致しない場合はnull', () => {
  assert.equal(classifyReaderLevelByRule('会計の考え方'), null);
  assert.equal(classifyReaderLevelByRule(null), null);
});

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function insertBook(db, { title, readerLevel = null, readerLevelSource = null }) {
  const result = db
    .prepare(
      "INSERT INTO books (status, title, title_is_fallback, reader_level, reader_level_source, updated_at) VALUES ('summarized', ?, 0, ?, ?, '2026-01-01')"
    )
    .run(title, readerLevel, readerLevelSource);
  return result.lastInsertRowid;
}

test('applyReaderLevelRules: ルールに一致する本にreader_levelとsource=ruleが設定される', () => {
  const db = makeDb();
  const id = insertBook(db, { title: 'Python入門' });

  const summary = applyReaderLevelRules(db);
  assert.equal(summary.beginnerCount, 1);
  assert.equal(summary.updated, 1);

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  assert.equal(book.reader_level, 'beginner');
  assert.equal(book.reader_level_source, 'rule');
  db.close();
});

test('applyReaderLevelRules: LLMで判定済み(source=llm)の本は上書きしない', () => {
  const db = makeDb();
  const id = insertBook(db, { title: '会計の考え方', readerLevel: 'intermediate', readerLevelSource: 'llm' });

  applyReaderLevelRules(db);

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  assert.equal(book.reader_level, 'intermediate');
  assert.equal(book.reader_level_source, 'llm');
  db.close();
});

test('applyReaderLevelRules: 再実行しても変化が無ければ0件（冪等）', () => {
  const db = makeDb();
  insertBook(db, { title: 'Python入門' });
  insertBook(db, { title: '会計の考え方' }); // ルール未判定のまま

  applyReaderLevelRules(db);
  const second = applyReaderLevelRules(db);
  assert.equal(second.updated, 0);
  db.close();
});

test('applyReaderLevelRules: タイトルが変わってルールに一致しなくなったらnullに戻る', () => {
  const db = makeDb();
  const id = insertBook(db, { title: 'Python入門', readerLevel: 'beginner', readerLevelSource: 'rule' });
  db.prepare('UPDATE books SET title = ? WHERE id = ?').run('会計の考え方', id); // ルール由来の判定を消すシミュレーション

  const summary = applyReaderLevelRules(db);
  assert.equal(summary.updated, 1);
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  assert.equal(book.reader_level, null);
  assert.equal(book.reader_level_source, null);
  db.close();
});
