import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseBookMarkdown, extractPublicationYear, parseFrontmatter } from '../../src/build/parse.js';

const FIXTURES_DIR = path.resolve('test/fixtures/output_data');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

test('通常の本を正しくパースできる', () => {
  const result = parseBookMarkdown(readFixture('normal_book.md'));
  assert.equal(result.ok, true);
  assert.equal(result.data.title, 'テスト用の会計入門book');
  assert.equal(result.data.author, '山田太郎');
  assert.deepEqual(result.data.keywords, ['会計', '簿記', '決算', '財務', '経営']);
  assert.match(result.data.summaryLong, /会計の基本的な考え方/);
  assert.match(result.data.summaryShort, /会計の基本を解説/);
  assert.equal(result.data.summaryLongIsFallback, false);
  assert.equal(result.data.reliability, 3);
  assert.equal(result.data.publicationYear, 2020);
});

test('ファイル名に [ ] を含むケースでも内容は問題なくパースできる', () => {
  const result = parseBookMarkdown(readFixture('[音声DL付]括弧付きファイル名book.md'));
  assert.equal(result.ok, true);
  assert.equal(result.data.title, '括弧付きファイル名のテストbook');
  assert.equal(result.data.isbn, null);
  assert.equal(result.data.series, null);
});

test('null項目が正しくnullとしてパースされる', () => {
  const result = parseBookMarkdown(readFixture('null_fields_book.md'));
  assert.equal(result.ok, true);
  assert.equal(result.data.series, null);
  assert.equal(result.data.edition, null);
  assert.equal(result.data.isbn, null);
  assert.equal(result.data.publicationDate, null);
  assert.equal(result.data.publicationYear, null);
});

test('極端に短い要約と6個のキーワード、和暦の日付をパースできる', () => {
  const result = parseBookMarkdown(readFixture('short_summary_book.md'));
  assert.equal(result.ok, true);
  assert.equal(result.data.summaryLong, '短い。');
  assert.equal(result.data.keywords.length, 6);
  assert.equal(result.data.publicationYear, 2023); // 令和5年 = 2019 + (5-1)
});

test('summary_longが取得失敗プレースホルダの場合、summary_shortで代替しフラグを立てる', () => {
  const result = parseBookMarkdown(readFixture('placeholder_summary_book.md'));
  assert.equal(result.ok, true);
  assert.equal(result.data.summaryLongIsFallback, true);
  assert.equal(result.data.summaryLong, result.data.summaryShort);
  assert.match(result.data.summaryLong, /詳細要約側は正常に取得できている/);
  assert.equal(result.data.publicationYear, 2012); // 漢数字「二〇一二年」
  assert.ok(result.warnings.some((w) => w.includes('代替した')));
});

test('titleがnullでもfileNameが指定されていればファイル名で代替される', () => {
  const result = parseBookMarkdown(readFixture('null_title_book.md'), { fileName: 'null_title_book.md' });
  assert.equal(result.ok, true);
  assert.equal(result.data.title, 'null_title_book');
  assert.equal(result.data.titleIsFallback, true);
  assert.ok(result.warnings.some((w) => w.includes('ファイル名で代替した')));
});

test('titleがnullでfileNameも指定されていない場合はok:falseになる', () => {
  const result = parseBookMarkdown(readFixture('null_title_book.md'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /title/);
});

test('フロントマターが無いファイルはok:falseで理由付きで報告される', () => {
  const result = parseBookMarkdown(readFixture('broken_no_frontmatter.md'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /フロントマター/);
});

test('見出し表記が想定と異なるファイルはok:falseで理由付きで報告される', () => {
  const result = parseBookMarkdown(readFixture('broken_missing_section.md'));
  assert.equal(result.ok, false);
  assert.match(result.reason, /初期要約/);
});

test('parseFrontmatter: 値にコロンを含むtitleも正しく読める', () => {
  const { fields } = parseFrontmatter([
    'title: "Think Bayes: Bayesian Statistics Made Simple"',
    'author: "Allen B. Downey"',
  ].join('\n'));
  assert.equal(fields.title, 'Think Bayes: Bayesian Statistics Made Simple');
});

test('extractPublicationYear: 各書式から西暦年を抽出できる', () => {
  assert.equal(extractPublicationYear('2020年6月19日'), 2020);
  assert.equal(extractPublicationYear('二〇一二年四月二〇日'), 2012);
  assert.equal(extractPublicationYear('令和5年6月30日'), 2023);
  assert.equal(extractPublicationYear('平成28年4月25日初版発行'), 2016);
  assert.equal(extractPublicationYear('2014-07-01'), 2014);
  assert.equal(extractPublicationYear('Copyright 2012'), 2012);
  assert.equal(extractPublicationYear('2018'), 2018);
  assert.equal(extractPublicationYear(null), null);
  assert.equal(extractPublicationYear('不明'), null);
});
