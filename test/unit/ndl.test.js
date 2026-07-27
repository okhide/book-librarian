import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchNdl,
  recordIsBookType,
  recordNdcCodes,
  recordIsbn,
  ndcSetsCompatible,
  splitAuthors,
  disambiguate,
  lookupByIsbn,
  lookupByTitle,
  resolveBook,
} from '../../src/lib/ndl.js';

function fakeSruResponse(records) {
  return `<searchRetrieveResponse><numberOfRecords>${records.length}</numberOfRecords><records>${records
    .map((r) => `<record>${r}</record>`)
    .join('')}</records></searchRetrieveResponse>`;
}

function fakeEmptyResponse() {
  // NDLは「該当なし」を診断（diagnostic）で返すことがある（<numberOfRecords>を含まない）。
  return '<searchRetrieveResponse><diagnostics><diagnostic><message>Record does not exist</message></diagnostic></diagnostics></searchRetrieveResponse>';
}

const BOOK_RECORD_WITH_NDC = `
  <dc:creator>古川裕也 著</dc:creator>
  <dcndl:materialType rdf:resource="http://ndl.go.jp/ndltype/Book" rdfs:label="図書"/>
  <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">978-4-88335-338-5</dcterms:identifier>
  <dcterms:subject rdf:resource="http://id.ndl.go.jp/class/ndc9/674.4"/>
`;

const SOUND_RECORD_SAME_AUTHOR = `
  <dc:creator>古川裕也 著</dc:creator>
  <dcndl:materialType rdf:resource="http://purl.org/dc/dcmitype/Sound" rdfs:label="録音資料"/>
`;

function getQueryParam(url, name) {
  return new URL(url).searchParams.get(name);
}

test('searchNdl: numberOfRecordsとrecordを正しくパースする', async () => {
  const fetchFn = async () => fakeSruResponse([BOOK_RECORD_WITH_NDC]);
  const { n, records } = await searchNdl('isbn=9784883353385', fetchFn);
  assert.equal(n, 1);
  assert.equal(records.length, 1);
});

test('searchNdl: 診断（該当なし）レスポンスは0件として扱う', async () => {
  const fetchFn = async () => fakeEmptyResponse();
  const { n, records } = await searchNdl('title="存在しない本"', fetchFn);
  assert.equal(n, 0);
  assert.equal(records.length, 0);
});

test('searchNdl: クエリがrecordSchema=dcndlでURLに渡される', async () => {
  let capturedUrl;
  const fetchFn = async (url) => {
    capturedUrl = url;
    return fakeSruResponse([]);
  };
  await searchNdl('isbn=123', fetchFn);
  assert.equal(getQueryParam(capturedUrl, 'recordSchema'), 'dcndl');
  assert.equal(getQueryParam(capturedUrl, 'query'), 'isbn=123');
});

test('recordIsBookType: 録音資料(Sound)は図書ではない', () => {
  assert.equal(recordIsBookType(BOOK_RECORD_WITH_NDC), true);
  assert.equal(recordIsBookType(SOUND_RECORD_SAME_AUTHOR), false);
});

test('recordNdcCodes: NDCコードを抽出する（無ければ空配列）', () => {
  assert.deepEqual(recordNdcCodes(BOOK_RECORD_WITH_NDC), ['674.4']);
  assert.deepEqual(recordNdcCodes(SOUND_RECORD_SAME_AUTHOR), []);
});

test('recordIsbn: ハイフンを除去して抽出する（無ければnull）', () => {
  assert.equal(recordIsbn(BOOK_RECORD_WITH_NDC), '9784883353385');
  assert.equal(recordIsbn(SOUND_RECORD_SAME_AUTHOR), null);
});

test('ndcSetsCompatible: 完全一致・同一大分類は矛盾なし、異なる大分類は矛盾', () => {
  assert.equal(ndcSetsCompatible(['222.03'], ['222.03']), true);
  assert.equal(ndcSetsCompatible(['222'], ['222.03']), true); // 精度違い
  assert.equal(ndcSetsCompatible(['361.4'], ['336.4']), false); // 別分類
  assert.equal(ndcSetsCompatible([], ['336.4']), true); // 片方欠落は矛盾なし
});

test('splitAuthors: 訳者括弧書きを除去し、コンマ区切りで分解する', () => {
  // 「・」は複数著者の区切りにも、カタカナ人名内の区切りにも使われるため、
  // 外国人名は名・姓に分割される（部分一致でのマッチングには支障がない）。
  assert.deepEqual(splitAuthors('ブリジッド・ディレイニー, 鶴見紀子（訳）'), ['ブリジッド', 'ディレイニー', '鶴見紀子']);
});

test('splitAuthors: 未指定はから配列', () => {
  assert.deepEqual(splitAuthors(null), []);
  assert.deepEqual(splitAuthors(undefined), []);
});

test('disambiguate: レコード0件はnot_found', () => {
  assert.deepEqual(disambiguate([], []), { status: 'not_found' });
});

test('disambiguate: 1件のみならそのままmatched', () => {
  const result = disambiguate([BOOK_RECORD_WITH_NDC], []);
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.ndcCodes, ['674.4']);
  assert.equal(result.isbn, '9784883353385');
});

test('disambiguate: 図書以外（オーディオブック等）を除外して1件に絞れる', () => {
  const result = disambiguate([BOOK_RECORD_WITH_NDC, SOUND_RECORD_SAME_AUTHOR], []);
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.ndcCodes, ['674.4']);
});

test('disambiguate: 著者一致で複数候補を1件に絞れる', () => {
  const otherAuthorBook = `
    <dc:creator>別の著者 著</dc:creator>
    <dcndl:materialType rdf:resource="http://ndl.go.jp/ndltype/Book" rdfs:label="図書"/>
    <dcterms:subject rdf:resource="http://id.ndl.go.jp/class/ndc9/999.9"/>
  `;
  const result = disambiguate([BOOK_RECORD_WITH_NDC, otherAuthorBook], ['古川裕也']);
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.ndcCodes, ['674.4']);
});

test('disambiguate: 著者一致後も複数残るがNDCが同一大分類なら矛盾なしとしてmatched', () => {
  const printEdition = `
    <dc:creator>古川裕也 著</dc:creator>
    <dcndl:materialType rdf:resource="http://ndl.go.jp/ndltype/Book" rdfs:label="図書"/>
    <dcterms:subject rdf:resource="http://id.ndl.go.jp/class/ndc9/674"/>
  `;
  const result = disambiguate([BOOK_RECORD_WITH_NDC, printEdition], ['古川裕也']);
  assert.equal(result.status, 'matched');
  assert.equal(result.candidateCount, 2);
  // より詳細な(コード長が長い)ほうが代表値として採用される
  assert.deepEqual(result.ndcCodes, ['674.4']);
});

test('disambiguate: NDC値が矛盾する場合はneeds_review', () => {
  const conflictingBook = `
    <dc:creator>古川裕也 著</dc:creator>
    <dcndl:materialType rdf:resource="http://ndl.go.jp/ndltype/Book" rdfs:label="図書"/>
    <dcterms:subject rdf:resource="http://id.ndl.go.jp/class/ndc9/159"/>
  `;
  const result = disambiguate([BOOK_RECORD_WITH_NDC, conflictingBook], ['古川裕也']);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.candidateCount, 2);
  assert.deepEqual(new Set(result.conflictingNdc), new Set(['674.4', '159']));
});

test('lookupByIsbn: isbn=クエリでNDLを検索する', async () => {
  let capturedQuery;
  const fetchFn = async (url) => {
    capturedQuery = getQueryParam(url, 'query');
    return fakeSruResponse([BOOK_RECORD_WITH_NDC]);
  };
  const { n } = await lookupByIsbn('9784883353385', fetchFn);
  assert.equal(n, 1);
  assert.equal(capturedQuery, 'isbn=9784883353385');
});

test('lookupByTitle: 元タイトルで0件でも正規化バリエーションでヒットする', async () => {
  const fetchFn = async (url) => {
    const query = getQueryParam(url, 'query');
    // 巻数除去後のタイトルでのみヒットする（spikeで実測した実例に対応）
    if (query === 'title="銃・病原菌・鉄 一万三〇〇〇年にわたる人類史の謎"') {
      return fakeSruResponse([BOOK_RECORD_WITH_NDC]);
    }
    return fakeEmptyResponse();
  };
  const { n, usedVariant } = await lookupByTitle('銃・病原菌・鉄 下巻 一万三〇〇〇年にわたる人類史の謎', fetchFn);
  assert.equal(n, 1);
  assert.equal(usedVariant, '銃・病原菌・鉄 一万三〇〇〇年にわたる人類史の謎');
});

test('lookupByTitle: 全バリエーションでヒットしなければ0件', async () => {
  const fetchFn = async () => fakeEmptyResponse();
  const { n } = await lookupByTitle('存在しない架空の本のタイトル', fetchFn);
  assert.equal(n, 0);
});

test('resolveBook: isbn既知でISBN検索が成功すればsource=ndl_isbn', async () => {
  const fetchFn = async (url) => {
    const query = getQueryParam(url, 'query');
    if (query.startsWith('isbn=')) return fakeSruResponse([BOOK_RECORD_WITH_NDC]);
    throw new Error('タイトル検索は呼ばれないはず');
  };
  const result = await resolveBook({ title: '書名', author: '古川裕也', isbn: '9784883353385' }, fetchFn);
  assert.equal(result.status, 'matched');
  assert.equal(result.source, 'ndl_isbn');
});

test('resolveBook: isbn検索で見つからなければタイトルへフォールバックする', async () => {
  const fetchFn = async (url) => {
    const query = getQueryParam(url, 'query');
    if (query.startsWith('isbn=')) return fakeEmptyResponse();
    return fakeSruResponse([BOOK_RECORD_WITH_NDC]);
  };
  const result = await resolveBook({ title: '書名', author: '古川裕也', isbn: '9999999999999' }, fetchFn);
  assert.equal(result.status, 'matched');
  assert.equal(result.source, 'ndl_title_fallback');
  // 入力isbnが誤り/古い可能性があるため、タイトル検索でヒットしたレコード側のISBNを採用する
  assert.equal(result.isbn, '9784883353385');
});

test('resolveBook: isbn不明ならタイトル検索のみ行う（source=ndl_title）', async () => {
  const fetchFn = async (url) => {
    const query = getQueryParam(url, 'query');
    assert.ok(!query.startsWith('isbn='), 'isbn不明時にisbn検索を呼んではいけない');
    return fakeSruResponse([BOOK_RECORD_WITH_NDC]);
  };
  const result = await resolveBook({ title: '書名', author: '古川裕也', isbn: null }, fetchFn);
  assert.equal(result.status, 'matched');
  assert.equal(result.source, 'ndl_title');
});
