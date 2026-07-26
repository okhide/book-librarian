// book_embeddingsに埋め込みが無い本を見つけて生成・保存する。
// 「行が無い」ことそのものが再生成の必要性を示す信号になる:
// - 新規本は最初から行が無い
// - updateBook()はembed_source_hashが変わった本だけembed_embeddingsの行を削除するため、
//   実質的な内容変更が無い更新では既存の埋め込みが温存される
import { buildEmbedSourceText } from '../lib/text.js';
import { embedText, toPassageText, DEFAULT_MODEL } from '../lib/embed.js';
import { floatArrayToBlob } from '../lib/vectorBlob.js';
import { getKeywordsForBook, getTopicsForBook } from './persist.js';

/** @param {import('better-sqlite3').Database} db */
export function findBooksNeedingEmbedding(db) {
  return db
    .prepare(
      `SELECT b.id, b.title, b.author, b.summary_long
       FROM books b
       LEFT JOIN book_embeddings e ON e.book_id = b.id
       WHERE e.book_id IS NULL AND b.status = 'summarized'`
    )
    .all();
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('@huggingface/transformers').FeatureExtractionPipeline} extractor
 * @param {{modelId?: string}} [options]
 * @returns {Promise<{generated: number, total: number}>}
 */
export async function generateMissingEmbeddings(db, extractor, options = {}) {
  const modelId = options.modelId ?? DEFAULT_MODEL;
  const candidates = findBooksNeedingEmbedding(db);
  const insertStmt = db.prepare(
    'INSERT INTO book_embeddings (book_id, embedding, dim, model) VALUES (?, ?, ?, ?)'
  );

  let generated = 0;
  for (const book of candidates) {
    const keywords = getKeywordsForBook(db, book.id);
    const topics = getTopicsForBook(db, book.id);
    const sourceText = buildEmbedSourceText({
      title: book.title,
      author: book.author,
      keywords,
      topics,
      summaryLong: book.summary_long,
    });

    const vec = await embedText(extractor, toPassageText(sourceText));
    const blob = floatArrayToBlob(vec);
    insertStmt.run(book.id, blob, vec.length, modelId);
    generated++;
  }

  return { generated, total: candidates.length };
}
