// Google Books API の薄いラッパー（補完・オプション機能）。
// NDLサーチで見つからなかった本のみを対象に、ISBN確認目的で追加照会する。
// NDC（日本十進分類法）は提供しないため取得しない（ISBN確認専用）。
// spike実測（NDLのnot_found40件中5件を対象）: 何かヒットしたのは2件、ISBN付きでヒットしたのは1件のみと
// 効果は限定的だが、無いよりはましなレベルとしてオプション採用する（既定は有効、ユーザーとの合意）。
// fetch関数を注入可能にし、自動テストでは実際にGoogle Booksを呼ばない（NDL連携と同じ方針）。

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';

/** 実際にGoogle Books APIへHTTPリクエストを送る既定のfetchFn。 */
export async function defaultFetchFn(url) {
  const res = await fetch(url);
  return res.json();
}

/**
 * 環境設定から見て、Google Books補完を使用すべきか判定する。
 * `ENRICHMENT_GOOGLE_BOOKS_ENABLED=false` で明示的に無効化しない限り既定で有効だが、
 * `GOOGLE_BOOKS_API_KEY` が無ければ実行不能なため合わせてfalseになる。
 */
export function isGoogleBooksEnabled() {
  if (process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED === 'false') return false;
  return !!process.env.GOOGLE_BOOKS_API_KEY;
}

function buildVolumesUrl(query, apiKey) {
  const params = new URLSearchParams({ q: query, country: 'JP', key: apiKey });
  return `${GOOGLE_BOOKS_ENDPOINT}?${params.toString()}`;
}

// 著者欄の最初の1名（訳者等の括弧書きを除く）を検索絞り込みに使う。
function mainAuthorToken(authorStr) {
  if (!authorStr) return null;
  const first = authorStr
    .split(/[,、・]/)[0]
    .replace(/[（(].*?[）)]/g, '')
    .trim();
  return first.length >= 2 ? first : null;
}

function extractIsbn(volumeInfo) {
  const ids = volumeInfo?.industryIdentifiers ?? [];
  const isbn13 = ids.find((i) => i.type === 'ISBN_13');
  if (isbn13) return isbn13.identifier;
  const isbn10 = ids.find((i) => i.type === 'ISBN_10');
  return isbn10 ? isbn10.identifier : null;
}

/**
 * タイトル（＋著者）でGoogle Booksを検索し、ISBNが取れた最初の候補を返す。
 * APIキー未設定時は素通りする（エラーにしない）。
 * @param {{title: string, author?: string}} book
 * @param {{fetchFn?: (url: string) => Promise<any>, apiKey?: string}} [options]
 * @returns {Promise<{status: 'matched', isbn: string, source: 'google_books'} | {status: 'not_found'}>}
 */
export async function lookupIsbnByTitle({ title, author }, options = {}) {
  const fetchFn = options.fetchFn ?? defaultFetchFn;
  const apiKey = options.apiKey ?? process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) return { status: 'not_found' };

  const authorToken = mainAuthorToken(author);
  const q = `intitle:${JSON.stringify(title)}${authorToken ? ` inauthor:${JSON.stringify(authorToken)}` : ''}`;
  const data = await fetchFn(buildVolumesUrl(q, apiKey));

  for (const item of data.items ?? []) {
    const isbn = extractIsbn(item.volumeInfo);
    if (isbn) return { status: 'matched', isbn, source: 'google_books' };
  }
  return { status: 'not_found' };
}
