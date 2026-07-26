// 結合試験: 実データ(data/output_data)全冊に対してパーサーを通し、
// doc/03_specification.md に記録した実測値と一致することを確認する。
// data/output_data は読み取り専用。このテストは一切書き込みを行わない。
// data/output_dataは元プロジェクト側で件数が増減しうるジャンクションのため、
// 総件数は固定値で決め打ちせず、ディレクトリの実スキャン件数と突き合わせる
// （2026-07-26、2,527冊→2,547冊への増加を機に決め打ちをやめた）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseBookMarkdown } from '../../src/build/parse.js';

const OUTPUT_DATA_DIR = path.resolve('data/output_data');

function loadAllBooks() {
  const files = fs.readdirSync(OUTPUT_DATA_DIR).filter((f) => f.endsWith('.md'));
  return files.map((file) => {
    const text = fs.readFileSync(path.join(OUTPUT_DATA_DIR, file), 'utf8');
    return { file, result: parseBookMarkdown(text, { fileName: file }) };
  });
}

test('実データ全冊がパースできる（[ ]を含むファイル名も含む）', () => {
  const expectedCount = fs.readdirSync(OUTPUT_DATA_DIR).filter((f) => f.endsWith('.md')).length;
  const books = loadAllBooks();
  console.log(`実データ件数: ${books.length}冊`);
  assert.equal(books.length, expectedCount, 'ディレクトリの実ファイル数と読み込み件数が一致しない');

  const failures = books.filter((b) => !b.result.ok);
  if (failures.length > 0) {
    console.log('パース失敗ファイル:', failures.map((f) => `${f.file}: ${f.result.reason}`));
  }
  assert.equal(failures.length, 0, `${failures.length}件のパースに失敗した`);

  const bracketFiles = books.filter((b) => b.file.includes('[') || b.file.includes(']'));
  console.log(`[ ] を含むファイル名: ${bracketFiles.length}件`);
  assert.ok(bracketFiles.length > 0, '[ ]を含むファイル名の検証ケースが無くなっている');
  assert.ok(bracketFiles.every((b) => b.result.ok), '[ ]を含むファイル名の本がパースに失敗した');
});

test('summary_long/summary_shortの文字数分布が実測値と一致する', () => {
  const books = loadAllBooks().map((b) => b.result.data);
  const longLens = books.map((b) => b.summaryLong.length).sort((a, b) => a - b);
  const shortLens = books.map((b) => b.summaryShort.length).sort((a, b) => a - b);

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // doc/03_specification.md の実測値: summary_long 平均807字、summary_short 平均164字
  // フォールバック適用後は多少下がるため、許容幅を持たせて検証する
  assert.ok(avg(longLens) > 700 && avg(longLens) < 900, `summary_long平均が想定外: ${avg(longLens)}`);
  assert.ok(avg(shortLens) > 140 && avg(shortLens) < 190, `summary_short平均が想定外: ${avg(shortLens)}`);
});

test('summary_longが取得失敗プレースホルダだった本が3冊検知され、summary_shortで代替されている', () => {
  const books = loadAllBooks().map((b) => ({ file: b.file, ...b.result.data }));
  const fallbacks = books.filter((b) => b.summaryLongIsFallback);
  assert.equal(fallbacks.length, 3);
  for (const b of fallbacks) {
    assert.equal(b.summaryLong, b.summaryShort);
  }
});

test('titleがnullでファイル名代用になった本が1冊（Rstat.md）検知される', () => {
  const books = loadAllBooks().map((b) => ({ file: b.file, ...b.result.data }));
  const fallbacks = books.filter((b) => b.titleIsFallback);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].file, 'Rstat.md');
  assert.equal(fallbacks[0].title, 'Rstat');
});

test('publication_yearの抽出カバレッジを記録する（参考値。失敗0件を強制はしない）', () => {
  const books = loadAllBooks().map((b) => b.result.data);
  const withDate = books.filter((b) => b.publicationDate !== null);
  const extracted = withDate.filter((b) => b.publicationYear !== null);
  const coverage = extracted.length / withDate.length;
  console.log(`publication_year抽出カバレッジ: ${extracted.length}/${withDate.length} (${(coverage * 100).toFixed(1)}%)`);
  // 大半（95%以上）は抽出できるはずという緩い期待値。厳密な100%は要求しない。
  assert.ok(coverage > 0.95, `カバレッジが低すぎる: ${(coverage * 100).toFixed(1)}%`);
});

test('keywordsの語彙統計が実測値と一致する（辞書設計の前提確認）', () => {
  const books = loadAllBooks().map((b) => b.result.data);
  const freq = new Map();
  let totalInstances = 0;
  for (const b of books) {
    for (const kw of b.keywords) {
      freq.set(kw, (freq.get(kw) ?? 0) + 1);
      totalInstances++;
    }
  }
  console.log(`ユニークキーワード数: ${freq.size}, 総出現数: ${totalInstances}`);
  // doc/03_specification.md の実測値: ユニーク8,780語、総出現12,656件
  assert.ok(freq.size > 8000 && freq.size < 9500, `ユニークキーワード数が想定外: ${freq.size}`);
});
