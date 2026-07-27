// ISBN・NDC分類の外部API補完（NDLサーチ優先、NDLで見つからない場合のみGoogle Booksでオプション補完）。
// spike/s12_isbn_ndc_lookup.mjsでの実測・doc/06_implementation_plan.mdの合意事項に基づく。
// Gemini/NotebookLM連携と同じ方針で、解決関数（resolveNdlFn/resolveGoogleBooksFn）を注入可能にし、
// 自動テストでは実際にNDL/Google Booksを呼ばない。
import { resolveBook as resolveViaNdl } from '../lib/ndl.js';
import { lookupIsbnByTitle, isGoogleBooksEnabled } from '../lib/googleBooks.js';

/**
 * 1冊分のISBN・NDC解決を行い、books・enrichment_candidatesを更新する。
 * @param {import('better-sqlite3').Database} db
 * @param {{id:number, file_path:string, title:string, author:string, isbn:string|null}} book
 * @param {{resolveNdlFn?: Function, resolveGoogleBooksFn?: Function, useGoogleBooks?: boolean}} [options]
 * @returns {Promise<{status: string, source?: string, isbn?: string|null, ndcCodes?: string[], candidateCount?: number, conflictingNdc?: string[]}>}
 */
export async function enrichBook(db, book, options = {}) {
  const resolveNdlFn = options.resolveNdlFn ?? resolveViaNdl;
  const resolveGoogleBooksFn = options.resolveGoogleBooksFn ?? lookupIsbnByTitle;
  const useGoogleBooks = options.useGoogleBooks ?? isGoogleBooksEnabled();

  let result = await resolveNdlFn({ title: book.title, author: book.author, isbn: book.isbn });

  // Google BooksはISBN確認専用の補完ソース（NDCは提供しない）。NDLで見つからない場合のみ試す。
  if (result.status === 'not_found' && useGoogleBooks) {
    const gb = await resolveGoogleBooksFn({ title: book.title, author: book.author });
    if (gb.status === 'matched') {
      result = { status: 'matched', isbn: gb.isbn, ndcCodes: [], source: gb.source };
    }
  }

  const now = new Date().toISOString();

  if (result.status === 'matched') {
    const ndc = result.ndcCodes && result.ndcCodes.length > 0 ? result.ndcCodes.join(',') : null;
    db.prepare(
      `UPDATE books SET enriched_isbn = ?, enriched_ndc = ?, enriched_source = ?,
         enrichment_status = 'matched', updated_at = ? WHERE id = ?`
    ).run(result.isbn ?? null, ndc, result.source ?? null, now, book.id);
    db.prepare('DELETE FROM enrichment_candidates WHERE file_path = ?').run(book.file_path);
  } else {
    db.prepare('UPDATE books SET enrichment_status = ?, updated_at = ? WHERE id = ?').run(result.status, now, book.id);
    db.prepare(
      `INSERT INTO enrichment_candidates (file_path, status, source, candidate_count, conflicting_ndc, created_at)
       VALUES (@filePath, @status, @source, @candidateCount, @conflictingNdc, @createdAt)
       ON CONFLICT(file_path) DO UPDATE SET
         status = @status, source = @source, candidate_count = @candidateCount,
         conflicting_ndc = @conflictingNdc, created_at = @createdAt`
    ).run({
      filePath: book.file_path,
      status: result.status,
      source: result.source ?? null,
      candidateCount: result.candidateCount ?? null,
      conflictingNdc: result.conflictingNdc ? JSON.stringify(result.conflictingNdc) : null,
      createdAt: now,
    });
  }

  return result;
}

/**
 * enrichment_status が未着手(NULL)の本を全て処理する。中断しても、
 * 未着手の本だけが対象になるため再実行すれば自動的に続行される。
 * @param {import('better-sqlite3').Database} db
 * @param {{resolveNdlFn?: Function, resolveGoogleBooksFn?: Function, useGoogleBooks?: boolean, onProgress?: (info: object) => void, delayMs?: number, limit?: number}} [options]
 */
export async function enrichPendingBooks(db, options = {}) {
  const { onProgress, delayMs = 0, limit } = options;
  const query = "SELECT id, file_path, title, author, isbn FROM books WHERE status = 'summarized' AND enrichment_status IS NULL";
  const books = limit ? db.prepare(`${query} LIMIT ?`).all(limit) : db.prepare(query).all();

  const summary = { total: books.length, matched: 0, notFound: 0, needsReview: 0 };

  for (const book of books) {
    const result = await enrichBook(db, book, options);
    if (result.status === 'matched') summary.matched++;
    else if (result.status === 'not_found') summary.notFound++;
    else if (result.status === 'needs_review') summary.needsReview++;

    if (onProgress) {
      onProgress({ book, result, processed: summary.matched + summary.notFound + summary.needsReview, total: summary.total });
    }
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return summary;
}
