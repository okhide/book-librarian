import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupIsbnByTitle, isGoogleBooksEnabled } from '../../src/lib/googleBooks.js';

function getQueryParam(url, name) {
  return new URL(url).searchParams.get(name);
}

test('lookupIsbnByTitle: ISBN_13が付いた候補が見つかればmatchedを返す', async () => {
  const fetchFn = async () => ({
    items: [{ volumeInfo: { title: '山田真哉の世界一受けたい簿記３級の授業', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9784000000000' }] } }],
  });
  const result = await lookupIsbnByTitle(
    { title: '山田真哉の世界一受けたい簿記３級の授業', author: '山田真哉' },
    { fetchFn, apiKey: 'dummy-key' }
  );
  assert.deepEqual(result, { status: 'matched', isbn: '9784000000000', source: 'google_books' });
});

test('lookupIsbnByTitle: ISBN_13が無ければISBN_10にフォールバックする', async () => {
  const fetchFn = async () => ({
    items: [{ volumeInfo: { industryIdentifiers: [{ type: 'ISBN_10', identifier: '4000000000' }] } }],
  });
  const result = await lookupIsbnByTitle({ title: '書名' }, { fetchFn, apiKey: 'dummy-key' });
  assert.deepEqual(result, { status: 'matched', isbn: '4000000000', source: 'google_books' });
});

test('lookupIsbnByTitle: ISBNが無い候補しか無ければnot_found', async () => {
  const fetchFn = async () => ({ items: [{ volumeInfo: { title: '別の本' } }] });
  const result = await lookupIsbnByTitle({ title: '書名' }, { fetchFn, apiKey: 'dummy-key' });
  assert.deepEqual(result, { status: 'not_found' });
});

test('lookupIsbnByTitle: itemsが無ければnot_found', async () => {
  const fetchFn = async () => ({ totalItems: 0 });
  const result = await lookupIsbnByTitle({ title: '書名' }, { fetchFn, apiKey: 'dummy-key' });
  assert.deepEqual(result, { status: 'not_found' });
});

test('lookupIsbnByTitle: APIキー未設定ならfetchFnを呼ばずnot_foundを返す', async () => {
  let called = false;
  const fetchFn = async () => {
    called = true;
    return { items: [] };
  };
  const result = await lookupIsbnByTitle({ title: '書名' }, { fetchFn, apiKey: undefined });
  assert.deepEqual(result, { status: 'not_found' });
  assert.equal(called, false);
});

test('lookupIsbnByTitle: intitle/inauthorクエリを組み立てる', async () => {
  let capturedUrl;
  const fetchFn = async (url) => {
    capturedUrl = url;
    return { items: [] };
  };
  await lookupIsbnByTitle({ title: '会話でわかる', author: '田中太郎, 佐藤（訳）' }, { fetchFn, apiKey: 'dummy-key' });
  const q = getQueryParam(capturedUrl, 'q');
  assert.match(q, /intitle:/);
  assert.match(q, /inauthor:"田中太郎"/);
  assert.equal(getQueryParam(capturedUrl, 'key'), 'dummy-key');
  assert.equal(getQueryParam(capturedUrl, 'country'), 'JP');
});

test('isGoogleBooksEnabled: ENRICHMENT_GOOGLE_BOOKS_ENABLED=falseなら無効', () => {
  const prevEnabled = process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED;
  const prevKey = process.env.GOOGLE_BOOKS_API_KEY;
  try {
    process.env.GOOGLE_BOOKS_API_KEY = 'dummy-key';
    process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED = 'false';
    assert.equal(isGoogleBooksEnabled(), false);
  } finally {
    if (prevEnabled === undefined) delete process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED;
    else process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED = prevEnabled;
    if (prevKey === undefined) delete process.env.GOOGLE_BOOKS_API_KEY;
    else process.env.GOOGLE_BOOKS_API_KEY = prevKey;
  }
});

test('isGoogleBooksEnabled: キーが有り明示的な無効化が無ければ既定で有効', () => {
  const prevEnabled = process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED;
  const prevKey = process.env.GOOGLE_BOOKS_API_KEY;
  try {
    delete process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED;
    process.env.GOOGLE_BOOKS_API_KEY = 'dummy-key';
    assert.equal(isGoogleBooksEnabled(), true);
  } finally {
    if (prevEnabled === undefined) delete process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED;
    else process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED = prevEnabled;
    if (prevKey === undefined) delete process.env.GOOGLE_BOOKS_API_KEY;
    else process.env.GOOGLE_BOOKS_API_KEY = prevKey;
  }
});

test('isGoogleBooksEnabled: キーが無ければ無効', () => {
  const prevEnabled = process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED;
  const prevKey = process.env.GOOGLE_BOOKS_API_KEY;
  try {
    delete process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED;
    delete process.env.GOOGLE_BOOKS_API_KEY;
    assert.equal(isGoogleBooksEnabled(), false);
  } finally {
    if (prevEnabled === undefined) delete process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED;
    else process.env.ENRICHMENT_GOOGLE_BOOKS_ENABLED = prevEnabled;
    if (prevKey === undefined) delete process.env.GOOGLE_BOOKS_API_KEY;
    else process.env.GOOGLE_BOOKS_API_KEY = prevKey;
  }
});
