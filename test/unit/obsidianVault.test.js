import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listNotes, writeNote } from '../../src/bridge/obsidian/vault.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-vault-test-'));
}

test('listNotes: .mdファイルのみを列挙する', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(path.join(dir, '2026-07-26_資本論.md'), '');
  fs.writeFileSync(path.join(dir, '2026-07-20_会計.md'), '');
  fs.writeFileSync(path.join(dir, 'メモ.txt'), '');
  const notes = listNotes(dir);
  assert.deepEqual(notes.sort(), ['2026-07-20_会計.md', '2026-07-26_資本論.md']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listNotes: queryを指定すると部分一致で絞り込む', () => {
  const dir = makeTmpDir();
  fs.writeFileSync(path.join(dir, '2026-07-26_資本論.md'), '');
  fs.writeFileSync(path.join(dir, '2026-07-20_会計.md'), '');
  const notes = listNotes(dir, { query: '資本論' });
  assert.deepEqual(notes, ['2026-07-26_資本論.md']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listNotes: 該当ファイルが無ければ空配列', () => {
  const dir = makeTmpDir();
  const notes = listNotes(dir, { query: '存在しない' });
  assert.deepEqual(notes, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeNote: create モードで新規ファイルを書き込める', () => {
  const dir = makeTmpDir();
  const fullPath = writeNote(dir, 'test.md', '# 本文');
  assert.equal(fs.readFileSync(fullPath, 'utf8'), '# 本文');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeNote: create モードで既存ファイルへの上書きは拒否される', () => {
  const dir = makeTmpDir();
  writeNote(dir, 'test.md', '# 元の内容');
  assert.throws(() => writeNote(dir, 'test.md', '# 別の内容'), /既にファイルが存在します/);
  assert.equal(fs.readFileSync(path.join(dir, 'test.md'), 'utf8'), '# 元の内容');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeNote: overwrite モードでは既存ファイルを上書きできる', () => {
  const dir = makeTmpDir();
  writeNote(dir, 'test.md', '# 元の内容');
  writeNote(dir, 'test.md', '# 更新後の内容', { mode: 'overwrite' });
  assert.equal(fs.readFileSync(path.join(dir, 'test.md'), 'utf8'), '# 更新後の内容');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeNote: 不明なmodeはエラー', () => {
  const dir = makeTmpDir();
  assert.throws(() => writeNote(dir, 'test.md', '内容', { mode: 'append' }), /不明なmode/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeNote: 存在しないディレクトリへの書き込みはエラー', () => {
  const dir = path.join(os.tmpdir(), 'obsidian-vault-not-exist-xyz');
  assert.throws(() => writeNote(dir, 'test.md', '内容'), /書き込み先ディレクトリが存在しません/);
});
