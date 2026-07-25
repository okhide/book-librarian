// reader_levelのルールベース判定。タイトルのシグナル語から判定できない本は
// null（未判定）のまま残し、Step 3.6でLLMに判定させる。
// 実データでシグナル語を検証した結果（doc/03_specification.md参照）:
// - 当初「実践」「完全」「マスター」「応用」を上級シグナルに含めていたが、
//   「Docker完全入門」「実践マーケティング入門」等、実際は初心者向け本の
//   タイトルを強調する修飾語として使われるケースが大半で誤判定を招いた。
// - そのため上級シグナルは明確に上級者向けと分かる語だけに絞った。
// - 両方のシグナルに一致する場合は初心者シグナルを優先する（「超入門」等の
//   強い初心者シグナルが、弱い上級シグナルの語と共存するケースがあったため）。

const BEGINNER_SIGNALS = [
  '入門', 'はじめて', 'ゼロから', '超入門', 'やさしい', '図解', '初心者',
  'わかる', 'キホン', '基本', '超基礎', '最初の一歩', '1年生',
];

const ADVANCED_SIGNALS = ['詳解', '上級', 'プロフェッショナル', '徹底攻略', '実務', 'プロが教える', '奥義'];

/** @returns {'beginner' | 'advanced' | null} */
export function classifyReaderLevelByRule(title) {
  if (!title) return null;
  if (BEGINNER_SIGNALS.some((s) => title.includes(s))) return 'beginner';
  if (ADVANCED_SIGNALS.some((s) => title.includes(s))) return 'advanced';
  return null;
}

/**
 * 全summarized本にルールベースのreader_level判定を適用する。
 * すでにLLMで判定済み(reader_level_source='llm')の本は上書きしない。
 * @param {import('better-sqlite3').Database} db
 * @returns {{checked: number, updated: number, beginnerCount: number, advancedCount: number}}
 */
export function applyReaderLevelRules(db) {
  const books = db
    .prepare(
      `SELECT id, title, reader_level, reader_level_source FROM books
       WHERE status = 'summarized' AND (reader_level_source IS NULL OR reader_level_source = 'rule')`
    )
    .all();

  const stmt = db.prepare(
    "UPDATE books SET reader_level = ?, reader_level_source = ?, updated_at = ? WHERE id = ?"
  );

  let updated = 0;
  let beginnerCount = 0;
  let advancedCount = 0;
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    for (const book of books) {
      const level = classifyReaderLevelByRule(book.title);
      if (level === 'beginner') beginnerCount++;
      if (level === 'advanced') advancedCount++;

      if (level !== book.reader_level) {
        stmt.run(level, level ? 'rule' : null, now, book.id);
        updated++;
      }
    }
  });
  run();

  return { checked: books.length, updated, beginnerCount, advancedCount };
}
