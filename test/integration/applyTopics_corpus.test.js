// 結合試験: 実データにtopic_taxonomy/topic_mapping/topic_overridesを適用した
//実際の状態(data/db/library.db)を検証する。Gemini APIは呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve('data/db/library.db');
const TAXONOMY_PATH = path.resolve('data/topic_taxonomy.json');

test('実データの本にtopicsが適用され、taxonomy外のトピックが無い', { skip: !fs.existsSync(DB_PATH) }, () => {
  const db = new Database(DB_PATH, { readonly: true });
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const validTopics = new Set(taxonomy.topics.map((t) => t.name));

  const withTopics = db
    .prepare(
      `SELECT COUNT(DISTINCT b.id) as n FROM books b
       JOIN book_topics bt ON bt.book_id = b.id
       WHERE b.status = 'summarized'`
    )
    .get().n;
  console.log(`topicsが1つ以上設定されているsummarized本: ${withTopics}件`);
  assert.ok(withTopics > 2000, `topics適用率が低すぎる: ${withTopics}`);

  const invalidTopics = db
    .prepare('SELECT DISTINCT topic FROM book_topics')
    .all()
    .filter((r) => !validTopics.has(r.topic));
  assert.deepEqual(invalidTopics, []);

  const totalSummarized = db.prepare("SELECT COUNT(*) as n FROM books WHERE status = 'summarized'").get().n;
  const withVersion = db
    .prepare("SELECT COUNT(*) as n FROM books WHERE status = 'summarized' AND topic_dict_version IS NOT NULL")
    .get().n;
  assert.equal(withVersion, totalSummarized, 'topic_dict_versionが未設定のsummarized本がある');

  db.close();
});

test('search_textにtopicsが反映されている（トピック名で検索できる）', { skip: !fs.existsSync(DB_PATH) }, () => {
  const db = new Database(DB_PATH, { readonly: true });
  const hit = db.prepare(`SELECT COUNT(*) as n FROM books WHERE search_text LIKE '%会計・財務%'`).get().n;
  assert.ok(hit > 0, 'トピック名がsearch_textに反映されていない');
  db.close();
});
