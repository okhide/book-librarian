import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { computeDictVersion, resolveTopicsForKeywords, applyTopicsToAllBooks } from '../../src/build/applyTopics.js';
import { getBookByFilePath, getTopicsForBook } from '../../src/build/persist.js';
import { floatArrayToBlob } from '../../src/lib/vectorBlob.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');

test('computeDictVersion: キーの順序が違っても同じハッシュになる（決定性）', () => {
  const taxonomy = { topics: [{ name: 'A', description: 'a' }] };
  const mapping1 = { 会計: 'A', 英語: 'A' };
  const mapping2 = { 英語: 'A', 会計: 'A' }; // 順序を入れ替え
  assert.equal(computeDictVersion(taxonomy, mapping1, {}), computeDictVersion(taxonomy, mapping2, {}));
});

test('computeDictVersion: 内容が変われば異なるハッシュになる', () => {
  const taxonomy = { topics: [{ name: 'A', description: 'a' }] };
  const v1 = computeDictVersion(taxonomy, { 会計: 'A' }, {});
  const v2 = computeDictVersion(taxonomy, { 会計: 'B' }, {});
  assert.notEqual(v1, v2);
});

test('resolveTopicsForKeywords: overridesがmappingを上書きする', () => {
  const topics = resolveTopicsForKeywords(['会計'], { 会計: 'A' }, { 会計: 'B' });
  assert.deepEqual(topics, ['B']);
});

test('resolveTopicsForKeywords: マッチしない/nullのキーワードは無視され、重複は除かれる', () => {
  const topics = resolveTopicsForKeywords(['会計', '簿記', '不明な語'], { 会計: 'A', 簿記: 'A', 不明な語: null }, {});
  assert.deepEqual(topics, ['A']);
});

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  return db;
}

function insertFakeEmbedding(db, bookId) {
  db.prepare('INSERT INTO book_embeddings (book_id, embedding, dim, model) VALUES (?, ?, ?, ?)').run(
    bookId,
    floatArrayToBlob(new Float32Array([1, 0, 0])),
    3,
    'fake-model'
  );
}

test('applyTopicsToAllBooks: 初回適用で全summarized本にtopicsとdict_versionが設定される', () => {
  const db = makeDb();
  const dict = {
    taxonomy: { topics: [{ name: '会計・財務', description: '' }] },
    mapping: { 会計: '会計・財務', 簿記: '会計・財務', 決算: '会計・財務', 財務: '会計・財務', 経営: '会計・財務' },
    overrides: {},
  };

  const { updated, totalCandidates, dictVersion } = applyTopicsToAllBooks(db, dict);
  assert.equal(totalCandidates, 6); // fixturesのsummarized本は6件
  assert.equal(updated, 6);

  const normalBook = getBookByFilePath(db, 'normal_book.md');
  assert.deepEqual(getTopicsForBook(db, normalBook.id), ['会計・財務']);
  assert.equal(normalBook.topic_dict_version, dictVersion);

  db.close();
});

test('applyTopicsToAllBooks: 辞書が変わらなければ再実行しても0件（冪等）', () => {
  const db = makeDb();
  const dict = {
    taxonomy: { topics: [{ name: '会計・財務', description: '' }] },
    mapping: { 会計: '会計・財務' },
    overrides: {},
  };

  applyTopicsToAllBooks(db, dict);
  const second = applyTopicsToAllBooks(db, dict);
  assert.equal(second.updated, 0);
  assert.equal(second.totalCandidates, 0);

  db.close();
});

test('applyTopicsToAllBooks: topicsが実際に変わらない本の埋め込みは温存される', () => {
  const db = makeDb();
  const dictV1 = {
    taxonomy: { topics: [{ name: '会計・財務', description: '' }, { name: '語学', description: '' }] },
    mapping: { 会計: '会計・財務', 英語: '語学' },
    overrides: {},
  };
  applyTopicsToAllBooks(db, dictV1);

  const normalBook = getBookByFilePath(db, 'normal_book.md'); // keywords: 会計,簿記,決算,財務,経営 → 会計・財務のみ
  const bracketBook = getBookByFilePath(db, '[音声DL付]括弧付きファイル名book.md'); // keywords: 英語,リスニング → 語学のみ
  insertFakeEmbedding(db, normalBook.id);
  insertFakeEmbedding(db, bracketBook.id);

  // dictV2: normalBookのtopicsには影響しない変更(語学の説明文だけ変える)
  const dictV2 = {
    taxonomy: { topics: [{ name: '会計・財務', description: '' }, { name: '語学', description: '説明変更' }] },
    mapping: { 会計: '会計・財務', 英語: '語学学習' }, // 英語の割り当て先トピック名を変更
    overrides: {},
  };
  applyTopicsToAllBooks(db, dictV2);

  const normalEmbedding = db.prepare('SELECT * FROM book_embeddings WHERE book_id = ?').get(normalBook.id);
  assert.ok(normalEmbedding != null, 'topicsが変わらないはずのnormal_bookの埋め込みが消えてしまった');

  const bracketEmbedding = db.prepare('SELECT * FROM book_embeddings WHERE book_id = ?').get(bracketBook.id);
  assert.equal(bracketEmbedding, undefined, 'topicsが変わったはずのbracket_bookの埋め込みが残っている');

  db.close();
});
