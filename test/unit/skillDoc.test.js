// SKILL.mdに書かれているCLIコマンド・フラグが実装と食い違っていないかを検証する
// (文書ドリフト検知)。src/librarian/SKILL.mdと.claude/skills/book-librarian/SKILL.md
// は同一内容であることを前提にしている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SKILL_PATH = path.resolve('src/librarian/SKILL.md');
const DISCOVERY_SKILL_PATH = path.resolve('.claude/skills/book-librarian/SKILL.md');

test('SKILL.mdにname/descriptionのフロントマターがある', () => {
  const text = fs.readFileSync(SKILL_PATH, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(fm, 'フロントマターが見つからない');
  assert.match(fm[1], /^name:\s*\S+/m);
  assert.match(fm[1], /^description:\s*\S+/m);
});

test('src/librarian/SKILL.mdと.claude/skills配下のコピーが同一内容である', () => {
  const source = fs.readFileSync(SKILL_PATH, 'utf8');
  const discovery = fs.readFileSync(DISCOVERY_SKILL_PATH, 'utf8');
  assert.equal(source, discovery);
});

test('SKILL.mdに書かれたCLIスクリプトが実際に存在する', () => {
  const text = fs.readFileSync(SKILL_PATH, 'utf8');
  const scriptPaths = [...text.matchAll(/node (src\/cli\/[a-zA-Z_.]+\.js)/g)].map((m) => m[1]);
  assert.ok(scriptPaths.length >= 5, 'CLIスクリプトの記載が想定より少ない');
  for (const p of new Set(scriptPaths)) {
    assert.ok(fs.existsSync(path.resolve(p)), `SKILL.mdに記載のスクリプトが存在しない: ${p}`);
  }
});

test('SKILL.mdに書かれたsearchのオプションが実装に存在する', () => {
  const skillText = fs.readFileSync(SKILL_PATH, 'utf8');
  const searchSource = fs.readFileSync(path.resolve('src/cli/search.js'), 'utf8');

  const optionTable = skillText.slice(skillText.indexOf('### `search`'), skillText.indexOf('### `show`'));
  const options = [...optionTable.matchAll(/`(--[a-z-]+)/g)].map((m) => m[1]);
  assert.ok(options.length >= 5);
  for (const opt of options) {
    assert.ok(searchSource.includes(`'${opt}'`), `SKILL.mdに記載のオプションが実装に無い: ${opt}`);
  }
});
