// CLIを実際に子プロセスとして起動して確認する。実際のObsidian Vaultには一切触れず、
// OBSIDIAN_VAULT_PATH経由でテスト用の一時ディレクトリを指す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = 'src/cli/obsidian.js';

function makeTmpVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-cli-test-'));
}

function runCli(args, vaultPath, extraEnv = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    env: { ...process.env, OBSIDIAN_VAULT_PATH: vaultPath, ...extraEnv },
    encoding: 'utf8',
  });
}

test('CLI', async (t) => {
  await t.test('filename --json: YYYYMMDD_トピック名の形式で返す', () => {
    const output = runCli(['filename', '--topic', '資本論の労働価値説', '--date', '2026-07-26', '--json'], '.');
    const parsed = JSON.parse(output);
    assert.equal(parsed.filename, '20260726_資本論の労働価値説.md');
  });

  await t.test('list --json: 空のVaultでは空配列（サブフォルダが自動作成される）', () => {
    const vaultPath = makeTmpVault();
    const output = runCli(['list', '--json'], vaultPath);
    assert.deepEqual(JSON.parse(output), { notes: [] });
    assert.ok(fs.statSync(path.join(vaultPath, 'book-librarian')).isDirectory());
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  await t.test('write --json → list --json: 既定のbook-librarianサブフォルダに書き込まれ、一覧に現れる', () => {
    const vaultPath = makeTmpVault();
    const specPath = path.join(vaultPath, '_spec.json');
    fs.writeFileSync(
      specPath,
      JSON.stringify({
        topic: '資本論の労働価値説',
        date: '2026-07-26',
        tags: ['book', '経済学'],
        book: { title: '資本論', author: 'カール・マルクス' },
        notebooklmSources: [{ id: 'abc123', title: '資本論 第一巻' }],
        body: '# まとめ\n労働価値説について。',
      }),
      'utf8'
    );

    const writeOutput = runCli(['write', '--spec-file', specPath, '--json'], vaultPath);
    const written = JSON.parse(writeOutput);
    assert.equal(written.filename, '20260726_資本論の労働価値説.md');
    assert.equal(written.path, path.join(vaultPath, 'book-librarian', written.filename));

    const content = fs.readFileSync(written.path, 'utf8');
    assert.match(content, /title: "資本論の労働価値説"/);
    assert.match(content, /book:\n {2}title: "資本論"\n {2}author: "カール・マルクス"/);
    assert.match(content, /notebooklm_sources:\n {2}- id: "abc123"/);
    assert.match(content, /# まとめ\n労働価値説について。/);

    const listOutput = runCli(['list', '--json'], vaultPath);
    const { notes } = JSON.parse(listOutput);
    assert.ok(notes.includes('20260726_資本論の労働価値説.md'));

    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  await t.test('OBSIDIAN_NOTES_SUBDIRを空にするとVault直下に書き込まれる', () => {
    const vaultPath = makeTmpVault();
    const specPath = path.join(vaultPath, '_spec.json');
    fs.writeFileSync(specPath, JSON.stringify({ topic: 'テスト', date: '2026-07-26', body: '本文' }), 'utf8');

    const writeOutput = runCli(['write', '--spec-file', specPath, '--json'], vaultPath, { OBSIDIAN_NOTES_SUBDIR: '' });
    const written = JSON.parse(writeOutput);
    assert.equal(written.path, path.join(vaultPath, '20260726_テスト.md'));

    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  await t.test('write: create モードで既存ファイルへの書き込みはエラー終了する', () => {
    const vaultPath = makeTmpVault();
    const specPath = path.join(vaultPath, '_spec.json');
    fs.writeFileSync(specPath, JSON.stringify({ topic: 'テスト', date: '2026-07-26', body: '本文' }), 'utf8');

    runCli(['write', '--spec-file', specPath], vaultPath);
    assert.throws(() => runCli(['write', '--spec-file', specPath], vaultPath), /既にファイルが存在します/);

    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  await t.test('write: overwriteモードで既存ファイルを更新できる', () => {
    const vaultPath = makeTmpVault();
    const specPath = path.join(vaultPath, '_spec.json');
    fs.writeFileSync(specPath, JSON.stringify({ topic: 'テスト', date: '2026-07-26', body: '本文1' }), 'utf8');
    runCli(['write', '--spec-file', specPath], vaultPath);

    fs.writeFileSync(specPath, JSON.stringify({ topic: 'テスト', date: '2026-07-26', body: '本文2' }), 'utf8');
    runCli(['write', '--spec-file', specPath, '--mode', 'overwrite'], vaultPath);

    const content = fs.readFileSync(path.join(vaultPath, 'book-librarian', '20260726_テスト.md'), 'utf8');
    assert.match(content, /本文2/);

    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  await t.test('list --query: トピック名で絞り込める', () => {
    const vaultPath = makeTmpVault();
    const notesDir = path.join(vaultPath, 'book-librarian');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(path.join(notesDir, '20260726_資本論.md'), '');
    fs.writeFileSync(path.join(notesDir, '20260720_会計.md'), '');

    const output = runCli(['list', '--query', '資本論', '--json'], vaultPath);
    assert.deepEqual(JSON.parse(output), { notes: ['20260726_資本論.md'] });

    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  await t.test('filename: topic未指定は使い方を表示して終了コード1', () => {
    assert.throws(() => runCli(['filename'], '.'));
  });
});
