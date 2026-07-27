// 国立国会図書館サーチ SRU API（recordSchema=dcndl）の薄いラッパー。
// spike/s12_isbn_ndc_lookup.mjsでの検証結果（ISBN検索優先＋タイトルフォールバック、
// 図書（Book）以外の除外、著者一致、NDC値の互換判定による曖昧さ解消）を本実装に移植したもの。
// fetch関数を注入可能にし、自動テストでは実際にNDLを呼ばない（Gemini/NotebookLM連携と同じ方針）。
import { titleSearchVariants } from './titleNormalize.js';

const NDL_SRU_ENDPOINT = 'https://ndlsearch.ndl.go.jp/api/sru';

/** 実際にNDLサーチへHTTPリクエストを送る既定のfetchFn。 */
export async function defaultFetchFn(url) {
  const res = await fetch(url);
  return res.text();
}

function buildSruUrl(cqlQuery) {
  const params = new URLSearchParams({
    operation: 'searchRetrieve',
    recordPacking: 'xml',
    recordSchema: 'dcndl',
    maximumRecords: '20',
    query: cqlQuery,
  });
  return `${NDL_SRU_ENDPOINT}?${params.toString()}`;
}

/**
 * CQLクエリでNDLサーチを検索する。
 * @param {string} cqlQuery 例: 'isbn=9784883353385' や 'title="銃・病原菌・鉄"'
 * @param {(url: string) => Promise<string>} [fetchFn]
 * @returns {Promise<{n: number, records: string[]}>} records は各<record>要素の中身（開始タグ除く生XML文字列）
 */
export async function searchNdl(cqlQuery, fetchFn = defaultFetchFn) {
  const text = await fetchFn(buildSruUrl(cqlQuery));
  const m = text.match(/<numberOfRecords>(\d+)<\/numberOfRecords>/);
  const n = m ? parseInt(m[1], 10) : 0;
  const records = text.split('<record>').slice(1);
  return { n, records };
}

/** 図書（Book）以外（オーディオブック・録音資料・DVD/CD等）のレコードでなければtrue。 */
export function recordIsBookType(rec) {
  return !/ndltype\/Sound|ndltype\/SoundDisc|dcmitype\/Sound/.test(rec);
}

/** レコードからNDC（日本十進分類法）コードを抽出する（NDLC等の他分類は含まない）。 */
export function recordNdcCodes(rec) {
  return [...rec.matchAll(/class\/ndc9\/([\d.]+)/g)].map((m) => m[1]);
}

/** レコードからISBN（ハイフン無しの数字列）を抽出する。無ければnull。 */
export function recordIsbn(rec) {
  const m = rec.match(/terms\/ISBN">([\d\-Xx]+)</);
  return m ? m[1].replace(/-/g, '') : null;
}

/**
 * 2つのNDCコード集合が「矛盾しない」か判定する。
 * 完全一致に加え、同じ大分類（小数点前3桁）を共有していれば、精度違い（例: 222 と 222.03）とみなし矛盾としない。
 * どちらかが空（NDC欠落）の場合は矛盾なしとして扱う。
 */
export function ndcSetsCompatible(setA, setB) {
  if (setA.length === 0 || setB.length === 0) return true;
  for (const a of setA) {
    for (const b of setB) {
      if (a === b) return true;
      if (a.split('.')[0] === b.split('.')[0]) return true;
    }
  }
  return false;
}

function normalizeName(s) {
  return s.replace(/[,、，\s　]/g, '');
}

/** フロントマターの著者欄（複数著者・訳者表記混じり）を比較用トークンに分解する。 */
export function splitAuthors(authorStr) {
  if (!authorStr) return [];
  return authorStr
    .split(/[,、・]/)
    .map((s) => s.replace(/[（(].*?[）)]/g, '').trim())
    .filter((s) => s.length >= 2)
    .map(normalizeName);
}

function recordMatchesAuthor(rec, authorTokens) {
  if (authorTokens.length === 0) return false;
  const normRec = normalizeName(rec);
  return authorTokens.some((a) => normRec.includes(a));
}

/**
 * 複数レコードから「確からしい1件」への絞り込みを試みる。
 * レコード件数が複数残っても、それが「同一書籍の別書誌（別版・別フォーマット等）」であれば
 * NDC値は一致する（または双方とも欠落する）はずなので曖昧さとはみなさない。
 * 本当にレビューが必要なのは、絞り込み後もNDC値が食い違う場合だけとする。
 * @param {string[]} records
 * @param {string[]} authorTokens
 * @returns {{status: 'matched'|'needs_review'|'not_found', ndcCodes?: string[], isbn?: string|null, candidateCount?: number, conflictingNdc?: string[]}}
 */
export function disambiguate(records, authorTokens) {
  if (records.length === 0) return { status: 'not_found' };

  let candidates = records.filter(recordIsBookType);
  if (candidates.length === 0) candidates = records;

  const authorMatched = candidates.filter((r) => recordMatchesAuthor(r, authorTokens));
  if (authorMatched.length > 0) candidates = authorMatched;

  if (candidates.length === 1) {
    return { status: 'matched', ndcCodes: recordNdcCodes(candidates[0]), isbn: recordIsbn(candidates[0]) };
  }

  const ndcSets = candidates.map((r) => recordNdcCodes(r));
  const nonEmptyNdcSets = ndcSets.filter((s) => s.length > 0);

  let allCompatible = true;
  for (let i = 0; i < nonEmptyNdcSets.length && allCompatible; i++) {
    for (let j = i + 1; j < nonEmptyNdcSets.length; j++) {
      if (!ndcSetsCompatible(nonEmptyNdcSets[i], nonEmptyNdcSets[j])) {
        allCompatible = false;
        break;
      }
    }
  }

  if (allCompatible) {
    const representative = nonEmptyNdcSets.sort((a, b) => b.join(',').length - a.join(',').length)[0] ?? [];
    const isbn = candidates.map(recordIsbn).find(Boolean) ?? null;
    return { status: 'matched', ndcCodes: representative, candidateCount: candidates.length, isbn };
  }

  const conflictingNdc = [...new Set(nonEmptyNdcSets.map((s) => [...s].sort().join(',')))];
  return { status: 'needs_review', candidateCount: candidates.length, conflictingNdc };
}

/** @param {(url: string) => Promise<string>} [fetchFn] */
export async function lookupByIsbn(isbn, fetchFn = defaultFetchFn) {
  return searchNdl(`isbn=${isbn}`, fetchFn);
}

/**
 * タイトル検索。正規化バリエーション（titleSearchVariants）を順に試し、最初にヒットしたものを返す。
 * @param {(url: string) => Promise<string>} [fetchFn]
 */
export async function lookupByTitle(title, fetchFn = defaultFetchFn) {
  for (const variant of titleSearchVariants(title)) {
    const cleanTitle = variant.replace(/"/g, '');
    const { n, records } = await searchNdl(`title="${cleanTitle}"`, fetchFn);
    if (n > 0) return { n, records, usedVariant: variant };
  }
  return { n: 0, records: [], usedVariant: title };
}

/**
 * 1冊分のISBN・NDC解決を行う（ISBN既知ならISBN検索優先、見つからなければタイトルへフォールバック）。
 * @param {{title: string, author?: string, isbn?: string|null}} book
 * @param {(url: string) => Promise<string>} [fetchFn]
 * @returns {Promise<{status: string, ndcCodes?: string[], isbn?: string|null, source: string, candidateCount?: number, conflictingNdc?: string[]}>}
 */
export async function resolveBook({ title, author, isbn }, fetchFn = defaultFetchFn) {
  const authorTokens = splitAuthors(author);

  if (isbn) {
    const byIsbn = await lookupByIsbn(isbn, fetchFn);
    if (byIsbn.n > 0) {
      const result = disambiguate(byIsbn.records, authorTokens);
      // ISBN検索で確定した場合、ISBN自体は既に確からしい（入力値）ため、レコード側の欠落で上書きしない。
      if (result.status !== 'not_found') return { ...result, isbn: result.isbn ?? isbn, source: 'ndl_isbn' };
    }
    const byTitle = await lookupByTitle(title, fetchFn);
    return { ...disambiguate(byTitle.records, authorTokens), source: 'ndl_title_fallback' };
  }

  const byTitle = await lookupByTitle(title, fetchFn);
  return { ...disambiguate(byTitle.records, authorTokens), source: 'ndl_title' };
}
