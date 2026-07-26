// 結合試験: 実データのoutput_dataと蔵書リスト.csvの突き合わせ。
// 両者は元プロジェクト側で個別に更新されうる（output_dataの方が先に増え、CSVの反映に
// タイムラグが生じることがある）ため、件数は決め打ちせずその都度実測する
// （2026-07-26、output_dataが2,527→2,547件に増えた一方CSVが未反映だったことを機に見直した）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../../src/lib/schema.js';
import { runFullBuild } from '../../src/build/fullBuild.js';
import { parseCatalogCsv, pickCanonicalRowsByMdFilename } from '../../src/build/csv.js';
import { reconcileCatalog } from '../../src/build/reconcileCsv.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');
const CSV_PATH = path.resolve('data/蔵書リスト.csv');

test('実データの突き合わせ: CSVに載っている本はoutput_dataに存在し、pendingは発生しない', () => {
  const expectedCount = fs.readdirSync(OUTPUT_DATA_DIR).filter((f) => f.endsWith('.md')).length;

  const db = new Database(':memory:');
  initSchema(db);
  const buildSummary = runFullBuild(db, OUTPUT_DATA_DIR);
  assert.equal(buildSummary.inserted, expectedCount);

  const rawText = fs.readFileSync(CSV_PATH, 'utf8');
  const { rows, warnings } = parseCatalogCsv(rawText);
  assert.equal(warnings.length, 0);
  const canonicalCount = pickCanonicalRowsByMdFilename(rows).size;
  console.log(`CSV行数: ${rows.length}（重複排除後${canonicalCount}件）, output_data: ${expectedCount}件`);

  const summary = reconcileCatalog(db, rows);

  // CSVに載っている本は必ずoutput_dataに存在する（本が消えることは無い）という前提のため、
  // pendingは常に0件のはず。CSVがoutput_dataより新しい本を先に参照するようになったら
  // ここで検知できる。
  assert.equal(summary.pendingInserted, 0, `CSVにあるがoutput_dataに無い本が${summary.pendingInserted}件見つかった`);
  assert.equal(summary.matched, canonicalCount);

  const totalBooks = db.prepare('SELECT COUNT(*) as n FROM books').get().n;
  assert.equal(totalBooks, expectedCount);

  const pendingCount = db.prepare("SELECT COUNT(*) as n FROM books WHERE status = 'pending'").get().n;
  assert.equal(pendingCount, 0);

  db.close();
});

test('csv_serialはほとんどのsummarized本に設定される（CSVの反映タイムラグを少数まで許容）', () => {
  const db = new Database(':memory:');
  initSchema(db);
  runFullBuild(db, OUTPUT_DATA_DIR);
  const rawText = fs.readFileSync(CSV_PATH, 'utf8');
  const { rows } = parseCatalogCsv(rawText);
  reconcileCatalog(db, rows);

  const total = db.prepare("SELECT COUNT(*) as n FROM books WHERE status = 'summarized'").get().n;
  const missing = db
    .prepare("SELECT COUNT(*) as n FROM books WHERE status = 'summarized' AND csv_serial IS NULL")
    .get().n;
  const missingRatio = missing / total;
  console.log(`csv_serial未設定: ${missing}/${total} (${(missingRatio * 100).toFixed(2)}%)`);
  // output_dataがCSVより先に更新されることがあるため、少数（5%未満）の未設定は許容する。
  // 大きく崩れた場合はCSVの取り込み自体に問題がある可能性が高いので検知する。
  assert.ok(missingRatio < 0.05, `csv_serial未設定の割合が想定より高い: ${(missingRatio * 100).toFixed(2)}%`);

  db.close();
});
