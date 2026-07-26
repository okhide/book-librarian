import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getVaultPath, getNotesDir } from '../../src/bridge/obsidian/config.js';

test('getVaultPath: OBSIDIAN_VAULT_PATH未設定はエラー', () => {
  const original = process.env.OBSIDIAN_VAULT_PATH;
  delete process.env.OBSIDIAN_VAULT_PATH;
  try {
    assert.throws(() => getVaultPath(), /OBSIDIAN_VAULT_PATHが設定されていません/);
  } finally {
    if (original !== undefined) process.env.OBSIDIAN_VAULT_PATH = original;
  }
});

test('getVaultPath: 存在しないディレクトリはエラー', () => {
  const original = process.env.OBSIDIAN_VAULT_PATH;
  process.env.OBSIDIAN_VAULT_PATH = path.join(os.tmpdir(), 'obsidian-vault-not-exist-xyz');
  try {
    assert.throws(() => getVaultPath(), /ディレクトリが存在しません/);
  } finally {
    if (original !== undefined) process.env.OBSIDIAN_VAULT_PATH = original;
    else delete process.env.OBSIDIAN_VAULT_PATH;
  }
});

test('getVaultPath: 実在するディレクトリはそのパスを返す', () => {
  const original = process.env.OBSIDIAN_VAULT_PATH;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-vault-'));
  process.env.OBSIDIAN_VAULT_PATH = tmpDir;
  try {
    assert.equal(getVaultPath(), tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (original !== undefined) process.env.OBSIDIAN_VAULT_PATH = original;
    else delete process.env.OBSIDIAN_VAULT_PATH;
  }
});

test('getNotesDir: 既定では"book-librarian"サブフォルダを作って返す', () => {
  const originalVault = process.env.OBSIDIAN_VAULT_PATH;
  const originalSubDir = process.env.OBSIDIAN_NOTES_SUBDIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-vault-'));
  process.env.OBSIDIAN_VAULT_PATH = tmpDir;
  delete process.env.OBSIDIAN_NOTES_SUBDIR;
  try {
    const notesDir = getNotesDir();
    assert.equal(notesDir, path.join(tmpDir, 'book-librarian'));
    assert.ok(fs.statSync(notesDir).isDirectory());
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalVault !== undefined) process.env.OBSIDIAN_VAULT_PATH = originalVault;
    else delete process.env.OBSIDIAN_VAULT_PATH;
    if (originalSubDir !== undefined) process.env.OBSIDIAN_NOTES_SUBDIR = originalSubDir;
  }
});

test('getNotesDir: OBSIDIAN_NOTES_SUBDIRで変更できる', () => {
  const originalVault = process.env.OBSIDIAN_VAULT_PATH;
  const originalSubDir = process.env.OBSIDIAN_NOTES_SUBDIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-vault-'));
  process.env.OBSIDIAN_VAULT_PATH = tmpDir;
  process.env.OBSIDIAN_NOTES_SUBDIR = 'リサーチ';
  try {
    const notesDir = getNotesDir();
    assert.equal(notesDir, path.join(tmpDir, 'リサーチ'));
    assert.ok(fs.statSync(notesDir).isDirectory());
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalVault !== undefined) process.env.OBSIDIAN_VAULT_PATH = originalVault;
    else delete process.env.OBSIDIAN_VAULT_PATH;
    if (originalSubDir !== undefined) process.env.OBSIDIAN_NOTES_SUBDIR = originalSubDir;
    else delete process.env.OBSIDIAN_NOTES_SUBDIR;
  }
});

test('getNotesDir: OBSIDIAN_NOTES_SUBDIRを空文字にするとVault直下になる', () => {
  const originalVault = process.env.OBSIDIAN_VAULT_PATH;
  const originalSubDir = process.env.OBSIDIAN_NOTES_SUBDIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-vault-'));
  process.env.OBSIDIAN_VAULT_PATH = tmpDir;
  process.env.OBSIDIAN_NOTES_SUBDIR = '';
  try {
    assert.equal(getNotesDir(), tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalVault !== undefined) process.env.OBSIDIAN_VAULT_PATH = originalVault;
    else delete process.env.OBSIDIAN_VAULT_PATH;
    if (originalSubDir !== undefined) process.env.OBSIDIAN_NOTES_SUBDIR = originalSubDir;
    else delete process.env.OBSIDIAN_NOTES_SUBDIR;
  }
});
