#!/usr/bin/env node
// topic_taxonomy.json + topic_mapping.json + topic_overrides.json を適用する。
// 使い方: node src/build/runApplyTopics.js
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { applyTopicsToAllBooks } from './applyTopics.js';
import { resolveDbPath } from '../cli/dbPath.js';

const TAXONOMY_PATH = path.resolve('data/topic_taxonomy.json');
const MAPPING_PATH = path.resolve('data/topic_mapping.json');
const OVERRIDES_PATH = path.resolve('data/topic_overrides.json');

const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));

const db = new Database(resolveDbPath());
const { dictVersion, updated, totalCandidates } = applyTopicsToAllBooks(db, { taxonomy, mapping, overrides });
db.close();

console.log(`辞書バージョン: ${dictVersion}`);
console.log(`再適用対象: ${totalCandidates}件 / 更新: ${updated}件`);
