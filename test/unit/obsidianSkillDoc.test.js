// SKILL.mdに書かれているCLIコマンドが実装と食い違っていないかを検証する
// (文書ドリフト検知)。src/obsidian/SKILL.mdと.claude/skills/obsidian-export/SKILL.md
// は同一内容であることを前提にしている（test/unit/skillDoc.test.jsと同じ方針）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SKILL_PATH = path.resolve('src/obsidian/SKILL.md');
const DISCOVERY_SKILL_PATH = path.resolve('.claude/skills/obsidian-export/SKILL.md');

test('SKILL.mdにname/descriptionのフロントマターがある', () => {
  const text = fs.readFileSync(SKILL_PATH, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(fm, 'フロントマターが見つからない');
  assert.match(fm[1], /^name:\s*\S+/m);
  assert.match(fm[1], /^description:\s*\S+/m);
});

test('src/obsidian/SKILL.mdと.claude/skills配下のコピーが同一内容である', () => {
  const source = fs.readFileSync(SKILL_PATH, 'utf8');
  const discovery = fs.readFileSync(DISCOVERY_SKILL_PATH, 'utf8');
  assert.equal(source, discovery);
});

test('SKILL.mdに書かれたCLIスクリプトが実際に存在する', () => {
  const text = fs.readFileSync(SKILL_PATH, 'utf8');
  const scriptPaths = [...text.matchAll(/node (src\/cli\/[a-zA-Z_.]+\.js)/g)].map((m) => m[1]);
  assert.ok(scriptPaths.length >= 1, 'CLIスクリプトの記載が無い');
  for (const p of new Set(scriptPaths)) {
    assert.ok(fs.existsSync(path.resolve(p)), `SKILL.mdに記載のスクリプトが存在しない: ${p}`);
  }
});

test('SKILL.mdに書かれたobsidian.jsのサブコマンドが実装に存在する', () => {
  const skillText = fs.readFileSync(SKILL_PATH, 'utf8');
  const cliSource = fs.readFileSync(path.resolve('src/cli/obsidian.js'), 'utf8');
  for (const cmd of ['filename', 'list', 'write']) {
    assert.ok(skillText.includes(`obsidian.js ${cmd}`), `SKILL.mdに${cmd}サブコマンドの記載が無い`);
    assert.ok(cliSource.includes(`'${cmd}'`), `実装に${cmd}サブコマンドが無い`);
  }
});
