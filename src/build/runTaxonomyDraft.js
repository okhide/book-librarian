#!/usr/bin/env node
// 実データからトピック分類表の草案を生成し、レビュー用ファイルに保存する。
// 使い方: node src/build/runTaxonomyDraft.js
process.loadEnvFile('.env');

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { frequentKeywords } from './topicVocab.js';
import { generateTaxonomyDraft } from './topicTaxonomyDraft.js';
import { resolveDbPath } from '../cli/dbPath.js';

const DRAFT_PATH = path.resolve('data/topic_taxonomy.draft.json');
const MIN_COUNT = 5; // doc/03_specification.mdの方針: 頻出語(5回以上=248語程度)を分類表作成に使う

const db = new Database(resolveDbPath(), { readonly: true });
const keywords = frequentKeywords(db, MIN_COUNT);
console.log(`頻出キーワード(${MIN_COUNT}回以上): ${keywords.length}語をもとに草案を生成します...`);

const draft = await generateTaxonomyDraft(keywords);
console.log(`生成されたトピック数: ${draft.topics.length}`);

fs.writeFileSync(DRAFT_PATH, JSON.stringify(draft, null, 2), 'utf8');
console.log(`草案を保存しました: ${DRAFT_PATH}`);
console.log('内容をレビューし、問題なければ data/topic_taxonomy.json として確定してください。');

db.close();
