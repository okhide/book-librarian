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

  t.after(() => {
    fs.rmSync(dbPath, { force: true });
  });
});
