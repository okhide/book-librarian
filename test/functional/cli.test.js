// CLIを実際に子プロセスとして起動して確認する。本番DBには一切触れず、
// テスト用に構築した一時ファイルDB(test/tmp/)をLIBRARIAN_DB_PATH経由で使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { generateMissingEmbeddings } from '../../src/build/embedBuild.js';
import { createEmbedder } from '../../src/lib/embed.js';
import { getBookByFilePath } from '../../src/build/persist.js';

const FIXTURES_OUTPUT_DATA = path.resolve('test/fixtures/output_data');
const TMP_ROOT = path.resolve('test/tmp');

async function buildTempDb(extractor) {
  const dbPath = path.join(TMP_ROOT, `cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(dbPath);
  initSchema(db);
  runFullBuild(db, FIXTURES_OUTPUT_DATA);
  await generateMissingEmbeddings(db, extractor);
  const normalBookId = getBookByFilePath(db, 'normal_book.md').id;
  db.prepare("INSERT INTO book_topics (book_id, topic) VALUES (?, '会計・財務')").run(normalBookId);
  db.prepare("UPDATE books SET reader_level = 'beginner' WHERE id = ?").run(normalBookId);
  db.prepare("UPDATE books SET drive_url = 'https://drive.google.com/file/d/TEST_FILE_ID/view' WHERE id = ?").run(
    normalBookId
  );
  db.close(); // 子プロセスから開けるようファイルロックを解放する
  return { dbPath, normalBookId };
}

function runCli(scriptPath, args, dbPath) {
  return execFileSync('node', [scriptPath, ...args], {
    env: { ...process.env, LIBRARIAN_DB_PATH: dbPath },
    encoding: 'utf8',
  });
}

test('CLI', async (t) => {
  const extractor = await createEmbedder();
  const { dbPath, normalBookId } = await buildTempDb(extractor);

  await t.test('search --json: 総ヒット件数と結果がJSONで返る', () => {
    const output = runCli('src/cli/search.js', ['会計', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok(parsed.totalCount >= 1);
    assert.equal(parsed.results[0].id, normalBookId);
  });

  await t.test('search: 人間可読形式で件数とタイトルが出る', () => {
    const output = runCli('src/cli/search.js', ['会計'], dbPath);
    assert.match(output, /件ヒット/);
    assert.match(output, /テスト用の会計入門book/);
  });

  await t.test('search --data-issues: 問題のある本が一覧できる', () => {
    const output = runCli('src/cli/search.js', ['--data-issues', '--json'], dbPath);
    const parsed = JSON.parse(output);
    // fixturesにはtitle_is_fallback=1件、summary_long_is_fallback=1件ある
    assert.ok(parsed.totalCount >= 2);
  });

  await t.test('show: summary_longが無加工で全文出力される', () => {
    const output = runCli('src/cli/show.js', [String(normalBookId)], dbPath);
    assert.match(output, /テスト用の会計入門book/);
    assert.match(output, /簿記は日々の取引を記録する技術である/); // summary_longの一部
  });

  await t.test('show: drive_urlがあれば蔵書本体へのリンクとして表示される', () => {
    const output = runCli('src/cli/show.js', [String(normalBookId)], dbPath);
    assert.match(output, /https:\/\/drive\.google\.com\/file\/d\/TEST_FILE_ID\/view/);
  });

  await t.test('show --json: 全フィールドがJSONで返る', () => {
    const output = runCli('src/cli/show.js', [String(normalBookId), '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.equal(parsed.title, 'テスト用の会計入門book');
    assert.ok(Array.isArray(parsed.keywords));
  });

  await t.test('show: 存在しないidはエラー終了する', () => {
    assert.throws(() => runCli('src/cli/show.js', ['999999'], dbPath));
  });

  await t.test('similar: 自分自身を除外して結果を返す', () => {
    const output = runCli('src/cli/similar.js', [String(normalBookId), '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok(parsed.every((r) => r.id !== normalBookId));
  });

  await t.test('search --topic: トピックで絞り込める', () => {
    const output = runCli('src/cli/search.js', ['会計', '--topic', '会計・財務', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok(parsed.results.some((r) => r.id === normalBookId));
  });

  await t.test('search --level: 存在しないレベルで絞り込むと0件になる', () => {
    const output = runCli('src/cli/search.js', ['会計', '--level', 'advanced', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.equal(parsed.totalCount, 0);
  });

  await t.test('search --unread: 読了済みにした本が除外される', () => {
    runCli('src/cli/read.js', [String(normalBookId), '--status', 'finished'], dbPath);
    const output = runCli('src/cli/search.js', ['会計', '--unread', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok(parsed.results.every((r) => r.id !== normalBookId));
    // 元に戻す（他のテストに影響しないように）
    runCli('src/cli/read.js', [String(normalBookId), '--status', 'unread'], dbPath);
  });

  await t.test('read --dormant: 未読本が要約日順に一覧できる', () => {
    const output = runCli('src/cli/read.js', ['--dormant', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.some((r) => r.id === normalBookId));
  });

  await t.test('topics: トピック一覧が件数付きで返る', () => {
    const output = runCli('src/cli/topics.js', ['--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok(parsed.some((t) => t.topic === '会計・財務' && t.count === 1));
  });

  await t.test('duplicates: 閾値を極端に低くすると全ペアが候補になる', () => {
    const output = runCli('src/cli/duplicates.js', ['--threshold', '-1', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.equal(parsed.threshold, -1);
    assert.ok(parsed.count > 0);
    assert.ok(parsed.pairs.every((p) => typeof p.titleA === 'string' && typeof p.titleB === 'string'));
  });

  await t.test('duplicates: --thresholdに非数値を渡すとエラー終了する（NaNが黙って通らない）', () => {
    assert.throws(() => runCli('src/cli/duplicates.js', ['--threshold', 'abc'], dbPath));
  });

  await t.test('notebooklm: 引数不足時はエラー終了し、使い方を表示する（実サービスは呼ばない）', () => {
    assert.throws(() => runCli('src/cli/notebooklm.js', ['register'], dbPath));
    assert.throws(() => runCli('src/cli/notebooklm.js', [], dbPath));
  });

  await t.test('search --with-summary: returnedCount/matchedByKeywordCount/truncatedを含み、全件summaryShortを持つ', () => {
    const output = runCli('src/cli/search.js', ['会計', '--with-summary', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok('returnedCount' in parsed);
    assert.ok('matchedByKeywordCount' in parsed);
    assert.ok('truncated' in parsed);
    assert.ok(parsed.matchedByKeywordCount <= parsed.returnedCount);
    assert.ok(parsed.results.every((r) => typeof r.summaryShort === 'string' && r.summaryShort.length > 0));
  });

  await t.test('read: 状態を記録して読み戻せる', () => {
    runCli('src/cli/read.js', [String(normalBookId), '--status', 'finished', '--rating', '5', '--note', '良かった'], dbPath);
    const output = runCli('src/cli/read.js', [String(normalBookId), '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.equal(parsed.status, 'finished');
    assert.equal(parsed.rating, 5);
    assert.equal(parsed.note, '良かった');
    assert.ok(parsed.finished_at != null);
  });

  await t.test('read --list: 記録した本が一覧に出る', () => {
    const output = runCli('src/cli/read.js', ['--list', '--status', 'finished', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok(parsed.some((r) => r.book_id === normalBookId));
  });

  await t.test('read: file_pathが無い本(pending)はエラーになる', () => {
    assert.throws(() => runCli('src/cli/read.js', ['999999', '--status', 'unread'], dbPath));
  });

  await t.test('stats: 統計一式がJSONで返る', () => {
    const output = runCli('src/cli/stats.js', ['--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.ok(parsed.statusCounts.some((r) => r.status === 'summarized'));
    assert.ok(parsed.topicCounts.some((r) => r.topic === '会計・財務'));
    assert.equal(parsed.dataIssuesCount, 2);
  });

  await t.test('stats --clusters: クラスタ情報が追加され、全件がいずれかのクラスタに含まれる', () => {
    // fixturesのsummarized本は6件のため、既定k=20だとエラーになる。--kで小さくする
    const output = runCli('src/cli/stats.js', ['--json', '--clusters', '--k', '2'], dbPath);
    const parsed = JSON.parse(output);
    assert.equal(parsed.clusters.length, 2);
    const totalSize = parsed.clusters.reduce((s, c) => s + c.size, 0);
    assert.equal(totalSize, 6);
  });

  await t.test('enrich review: レビュー待ちの本が一覧できる', () => {
    const db = new Database(dbPath);
    db.prepare("UPDATE books SET enrichment_status = 'needs_review' WHERE id = ?").run(normalBookId);
    db.prepare(
      `INSERT INTO enrichment_candidates (file_path, status, source, candidate_count, conflicting_ndc, created_at)
       VALUES ('normal_book.md', 'needs_review', 'ndl_title', 2, '["159","336"]', '2026-01-01')`
    ).run();
    db.close();

    const output = runCli('src/cli/enrich.js', ['review', '--json'], dbPath);
    const parsed = JSON.parse(output);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].book_id, normalBookId);
    assert.equal(parsed[0].candidate_count, 2);
  });

  await t.test('enrich resolve: 手動確定するとレビュー一覧から消える', () => {
    runCli('src/cli/enrich.js', ['resolve', '--id', String(normalBookId), '--isbn', '9784000000000', '--ndc', '159'], dbPath);

    const reviewOutput = runCli('src/cli/enrich.js', ['review', '--json'], dbPath);
    assert.deepEqual(JSON.parse(reviewOutput), []);

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT * FROM books WHERE id = ?').get(normalBookId);
    assert.equal(row.enriched_isbn, '9784000000000');
    assert.equal(row.enriched_source, 'manual');
    db.close();
  });

  await t.test('enrich resolve: --isbnが無くても--ndcだけで確定できる', () => {
    const db = new Database(dbPath);
    db.prepare("UPDATE books SET enrichment_status = 'needs_review' WHERE id = ?").run(normalBookId);
    db.prepare(
      `INSERT INTO enrichment_candidates (file_path, status, source, candidate_count, conflicting_ndc, created_at)
       VALUES ('normal_book.md', 'needs_review', 'ndl_title', 2, '["159","336"]', '2026-01-01')`
    ).run();
    db.close();

    runCli('src/cli/enrich.js', ['resolve', '--id', String(normalBookId), '--ndc', '141.62'], dbPath);

    const checkDb = new Database(dbPath, { readonly: true });
    const row = checkDb.prepare('SELECT * FROM books WHERE id = ?').get(normalBookId);
    assert.equal(row.enriched_isbn, null);
    assert.equal(row.enriched_ndc, '141.62');
    assert.equal(row.enrichment_status, 'matched');
    checkDb.close();
  });

  await t.test('enrich resolve: --isbn/--ndcどちらも無ければエラー終了する', () => {
    assert.throws(() => runCli('src/cli/enrich.js', ['resolve', '--id', String(normalBookId)], dbPath));
  });

  t.after(() => {
    fs.rmSync(dbPath, { force: true });
  });
});
