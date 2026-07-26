// Obsidianノートのfrontmatter（YAML）を組み立てる（doc/06_implementation_plan.md Phase 8）。
// 汎用YAMLライブラリは使わず、この用途で必要な形（文字列・配列・入れ子オブジェクトの配列）
// だけを扱う最小限のシリアライザを自作する（依存を増やさない方針、doc/04_design.md参照）。
// 全ての文字列スカラーは常にダブルクォートで囲む。コロン・引用符等を含む値でも
// 条件分岐なしに常に安全であることを優先した。

function quoteScalar(value) {
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function indent(text, level) {
  const pad = '  '.repeat(level);
  return text
    .split('\n')
    .map((line) => (line === '' ? line : pad + line))
    .join('\n');
}

/**
 * @param {{
 *   title: string,
 *   createdAt?: string,
 *   tags?: string[],
 *   book?: {title?: string, author?: string, isbn?: string},
 *   notebooklmSources?: Array<{id: string, title: string}>
 * }} params
 * @returns {string} "---\n...\n---\n" 形式のfrontmatterブロック
 */
export function buildFrontmatter({ title, createdAt, tags = [], book, notebooklmSources }) {
  if (!title) throw new Error('titleは必須です');

  const lines = [];
  lines.push(`title: ${quoteScalar(title)}`);
  lines.push(`created: ${quoteScalar(createdAt ?? new Date().toISOString().slice(0, 10))}`);

  if (tags.length > 0) {
    lines.push(`tags: [${tags.map(quoteScalar).join(', ')}]`);
  } else {
    lines.push('tags: []');
  }

  if (book && (book.title || book.author || book.isbn)) {
    lines.push('book:');
    if (book.title) lines.push(indent(`title: ${quoteScalar(book.title)}`, 1));
    if (book.author) lines.push(indent(`author: ${quoteScalar(book.author)}`, 1));
    if (book.isbn) lines.push(indent(`isbn: ${quoteScalar(book.isbn)}`, 1));
  }

  if (notebooklmSources && notebooklmSources.length > 0) {
    lines.push('notebooklm_sources:');
    for (const source of notebooklmSources) {
      lines.push(indent(`- id: ${quoteScalar(source.id)}`, 1));
      lines.push(indent(`  title: ${quoteScalar(source.title)}`, 1));
    }
  }

  return `---\n${lines.join('\n')}\n---\n`;
}
