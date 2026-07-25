// ルールベースで判定できなかった本のreader_levelをLLMで補完する（Step 3.6）。
// Step 3.3ではキーワード文字列をキーにしたため、LLMがテキストを書き換えて
// 返す問題が発生した。今回はbook_id（数値）をキーにすることでこの問題を
// 構造的に回避する。
import { chunkArray } from './topicMapping.js';

const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];

const LEVEL_SCHEMA = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, level: { type: 'string' } },
        required: ['id', 'level'],
      },
    },
  },
  required: ['classifications'],
};

export function buildReaderLevelPrompt(batchBooks) {
  const bookList = batchBooks
    .map(
      (b) =>
        `- id=${b.id}: 書名「${b.title}」 / キーワード: ${b.keywords.join('、') || 'なし'} / 概要: ${b.summaryShort || 'なし'}`
    )
    .join('\n');
  return `以下は蔵書の一覧です。それぞれの本について、読者に必要な前提知識のレベルを
beginner(初心者向け・入門書) / intermediate(中級者向け・一般的な実用書) / advanced(上級者向け・専門書)
のいずれかに分類してください。判断材料が乏しい場合はintermediateとしてください。

${bookList}

各本についてid（上記の数値をそのまま使うこと）とlevelの組を classifications 配列で返してください。
入力された${batchBooks.length}件全てについて必ず1件ずつ結果を返すこと（省略しないこと）。`;
}

/**
 * @param {Array<{id:number, title:string, keywords:string[], summaryShort:string}>} batchBooks
 * @param {(prompt: string, schema: object) => Promise<any>} generateFn
 * @returns {Promise<{levels: Map<number, string|null>, invalidCount: number}>}
 */
export async function classifyReaderLevelBatch(batchBooks, generateFn) {
  const prompt = buildReaderLevelPrompt(batchBooks);
  const result = await generateFn(prompt, LEVEL_SCHEMA);

  const levels = new Map();
  let invalidCount = 0;
  const inputIds = new Set(batchBooks.map((b) => b.id));

  for (const c of result.classifications) {
    if (!inputIds.has(c.id)) continue; // 入力に無いidは無視（数値なので書き換わることは想定していない）
    if (!VALID_LEVELS.includes(c.level)) {
      invalidCount++;
      levels.set(c.id, null);
      continue;
    }
    levels.set(c.id, c.level);
  }

  // 応答に含まれなかった本はnullのままにする（未判定として残り、次回再試行される）
  for (const b of batchBooks) {
    if (!levels.has(b.id)) {
      levels.set(b.id, null);
      invalidCount++;
    }
  }

  return { levels, invalidCount };
}

/**
 * status='summarized'かつreader_levelが未判定(NULL)の本をLLMで分類する。
 * level=nullの本はDBを更新しないため、次回実行時にも対象として残る（自然な再試行）。
 * @param {import('better-sqlite3').Database} db
 * @param {{batchSize?: number, classifyBatchFn: (batch: object[]) => Promise<{levels: Map, invalidCount: number}>, onBatchComplete?: (info: object) => void}} options
 */
export async function generateReaderLevelsForUnclassified(db, options) {
  const { batchSize = 100, classifyBatchFn, onBatchComplete } = options;

  const books = db
    .prepare("SELECT id, title, summary_short FROM books WHERE status = 'summarized' AND reader_level IS NULL")
    .all();
  const getKeywords = db.prepare('SELECT keyword FROM book_keywords WHERE book_id = ?');
  const enriched = books.map((b) => ({
    id: b.id,
    title: b.title,
    summaryShort: b.summary_short,
    keywords: getKeywords.all(b.id).map((r) => r.keyword),
  }));

  const batches = chunkArray(enriched, batchSize);
  const updateStmt = db.prepare(
    "UPDATE books SET reader_level = ?, reader_level_source = 'llm', updated_at = ? WHERE id = ?"
  );

  let totalInvalid = 0;
  let processed = 0;

  for (const batch of batches) {
    const { levels, invalidCount } = await classifyBatchFn(batch);
    totalInvalid += invalidCount;

    const now = new Date().toISOString();
    const run = db.transaction(() => {
      for (const [bookId, level] of levels) {
        if (level) updateStmt.run(level, now, bookId);
      }
    });
    run();

    processed += batch.length;
    if (onBatchComplete) onBatchComplete({ processed, totalInvalid });
  }

  return { totalBooks: enriched.length, batchesProcessed: batches.length, totalInvalid };
}
