import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrontmatter } from '../../src/bridge/obsidian/frontmatter.js';

test('buildFrontmatter: 最小構成（title, created, 空tags）', () => {
  const fm = buildFrontmatter({ title: 'テスト', createdAt: '2026-07-26' });
  assert.equal(
    fm,
    '---\ntitle: "テスト"\ncreated: "2026-07-26"\ntags: []\n---\n'
  );
});

test('buildFrontmatter: tagsが指定されると配列で出力される', () => {
  const fm = buildFrontmatter({ title: 'テスト', createdAt: '2026-07-26', tags: ['book', '経済学'] });
  assert.match(fm, /tags: \["book", "経済学"\]/);
});

test('buildFrontmatter: コロン・引用符を含む値でも壊れない（常にダブルクォート＋エスケープ）', () => {
  const fm = buildFrontmatter({
    title: '作者の主張: "労働価値説"とは何か',
    createdAt: '2026-07-26',
  });
  assert.equal(
    fm,
    '---\ntitle: "作者の主張: \\"労働価値説\\"とは何か"\ncreated: "2026-07-26"\ntags: []\n---\n'
  );
});

test('buildFrontmatter: bookが指定されると書誌情報がネストして出力される', () => {
  const fm = buildFrontmatter({
    title: 'テスト',
    createdAt: '2026-07-26',
    book: { title: '資本論', author: 'カール・マルクス', isbn: '978-4-00-341234-1' },
  });
  assert.match(fm, /book:\n {2}title: "資本論"\n {2}author: "カール・マルクス"\n {2}isbn: "978-4-00-341234-1"/);
});

test('buildFrontmatter: bookの一部フィールドのみでも出力される', () => {
  const fm = buildFrontmatter({ title: 'テスト', createdAt: '2026-07-26', book: { title: '資本論' } });
  assert.match(fm, /book:\n {2}title: "資本論"\n---/);
});

test('buildFrontmatter: bookが全て未指定ならbookキー自体が出力されない', () => {
  const fm = buildFrontmatter({ title: 'テスト', createdAt: '2026-07-26', book: {} });
  assert.ok(!fm.includes('book:'));
});

test('buildFrontmatter: notebooklmSourcesが複数指定されると配列で出力される', () => {
  const fm = buildFrontmatter({
    title: 'テスト',
    createdAt: '2026-07-26',
    notebooklmSources: [
      { id: 'abc123', title: '資本論 第一巻' },
      { id: 'def456', title: 'マルクス経済学入門' },
    ],
  });
  assert.match(
    fm,
    /notebooklm_sources:\n {2}- id: "abc123"\n {4}title: "資本論 第一巻"\n {2}- id: "def456"\n {4}title: "マルクス経済学入門"/
  );
});

test('buildFrontmatter: notebooklmSources未指定なら該当キーが出力されない', () => {
  const fm = buildFrontmatter({ title: 'テスト', createdAt: '2026-07-26' });
  assert.ok(!fm.includes('notebooklm_sources'));
});

test('buildFrontmatter: createdAt省略時は今日の日付が使われる', () => {
  const fm = buildFrontmatter({ title: 'テスト' });
  assert.match(fm, /created: "\d{4}-\d{2}-\d{2}"/);
});

test('buildFrontmatter: titleが無いとエラー', () => {
  assert.throws(() => buildFrontmatter({ createdAt: '2026-07-26' }), /titleは必須/);
});
