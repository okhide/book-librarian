// spike S12: ISBN・NDC分類の外部API補完がどの程度「確からしい1件」を得られるか実測する。
// 使い方: node spike/s12_isbn_ndc_lookup.mjs [groupAサンプル数=100] [groupBサンプル数=150]
//
// 事前のアドホック確認で判明したこと（本スパイクの設計根拠）:
// - openBD（hanmoto.ndc9）はNDCデータがほぼ入っていない（実測30件中1件、100件中0件）ため不採用。
// - NDLサーチSRU（recordSchema=dcndl）はISBN検索でヒットすればNDC/NDLC分類がほぼ100%付与されている。
// - NDLサーチは同一著作の別形態（オーディオブック・点字・デイジー等）が別レコードとして
//   ヒットすることが複数ヒットの主因の一つ。dcndl:materialType が Book のものを優先すると
//   曖昧さの多くを解消できる。
// - ISBN検索で見つからない場合、タイトル検索でフォールバックすると一定数回収できる。
// - タイトルが長い副題付きの場合、生タイトルで0件ならタイトル前半のみで再検索する。
process.loadEnvFile?.('.env');

import Database from 'better-sqlite3';
import { resolveDbPath } from '../src/cli/dbPath.js';
import { titleSearchVariants } from '../src/lib/titleNormalize.js';

const GROUP_A_SIZE = Number(process.argv[2] ?? 100);
const GROUP_B_SIZE = Number(process.argv[3] ?? 150);
const REQUEST_INTERVAL_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(s) {
  return s.replace(/[,、，\s　]/g, '');
}

function splitAuthors(authorStr) {
  if (!authorStr) return [];
  return authorStr
    .split(/[,、・]/)
    .map((s) => s.replace(/[（(].*?[）)]/g, '').trim())
    .filter((s) => s.length >= 2)
    .map(normalizeName);
}

async function ndlSearch(cqlQuery) {
  const url =
    'https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&recordPacking=xml&recordSchema=dcndl&maximumRecords=20&query=' +
    encodeURIComponent(cqlQuery);
  const res = await fetch(url);
  const text = await res.text();
  const m = text.match(/<numberOfRecords>(\d+)<\/numberOfRecords>/);
  const n = m ? parseInt(m[1], 10) : 0;
  const records = text.split('<record>').slice(1);
  return { n, records };
}

function recordIsBookType(rec) {
  // 図書（Book）以外（オーディオブック・録音資料・DVD/CD等）を除外する。
  if (/ndltype\/Sound|ndltype\/SoundDisc|dcmitype\/Sound/.test(rec)) return false;
  return true;
}

function recordNdcCodes(rec) {
  return [...rec.matchAll(/class\/ndc9\/([\d.]+)/g)].map((m) => m[1]);
}

function recordHasClassification(rec) {
  return /class\/ndc9\/|class\/ndlc\//.test(rec);
}

// 2つのNDCコード集合が「矛盾しない」か判定する。
// 完全一致に加え、同じ大分類（小数点前の3桁）を共有していれば、精度違い（例: 222 と 222.03）とみなし矛盾としない。
function ndcSetsCompatible(setA, setB) {
  if (setA.length === 0 || setB.length === 0) return true;
  for (const a of setA) {
    for (const b of setB) {
      if (a === b) return true;
      if (a.split('.')[0] === b.split('.')[0]) return true;
    }
  }
  return false;
}

function recordMatchesAuthor(rec, authorTokens) {
  if (authorTokens.length === 0) return false;
  const normRec = normalizeName(rec);
  return authorTokens.some((a) => normRec.includes(a));
}

// 複数レコードから「確からしい1件」への絞り込みを試みる。
// ポイント: レコード件数が複数残っても、それが「同一書籍の別書誌"(別版・別フォーマット等)」であれば
// NDC値は一致する（または双方とも欠落する）はずなので、曖昧さとはみなさない。
// 本当に人間のレビューが必要なのは、絞り込み後もNDC値が食い違う場合だけとする。
// 戻り値: { status: 'matched'|'needs_review'|'not_found', ndcCodes? }
function disambiguate(records, authorTokens) {
  if (records.length === 0) return { status: 'not_found' };

  // 1. 図書（Book）のみに絞る（該当が無ければ絞り込まない）
  let candidates = records.filter(recordIsBookType);
  if (candidates.length === 0) candidates = records;

  // 2. 著者一致で絞る（一致が0件なら絞り込みをかけない＝著者表記のズレを許容する）
  const authorMatched = candidates.filter((r) => recordMatchesAuthor(r, authorTokens));
  if (authorMatched.length > 0) candidates = authorMatched;

  if (candidates.length === 1) {
    return { status: 'matched', ndcCodes: recordNdcCodes(candidates[0]) };
  }

  // 3. 残った候補間でNDC値が矛盾しないか（同一分類の精度違いを含め）を確認する
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
    // 最も詳細（コード長が長い）ものを代表値として採用する
    const representative = nonEmptyNdcSets.sort((a, b) => b.join(',').length - a.join(',').length)[0] ?? [];
    return { status: 'matched', ndcCodes: representative, collapsedFromCount: candidates.length };
  }

  const conflictKeys = [...new Set(nonEmptyNdcSets.map((s) => [...s].sort().join(',')))];
  return { status: 'needs_review', candidateCount: candidates.length, conflictingNdc: conflictKeys };
}

async function lookupByIsbn(isbn) {
  const { n, records } = await ndlSearch(`isbn=${isbn}`);
  await sleep(REQUEST_INTERVAL_MS);
  return { n, records };
}

async function lookupByTitle(title) {
  for (const variant of titleSearchVariants(title)) {
    const cleanTitle = variant.replace(/"/g, '');
    const { n, records } = await ndlSearch(`title="${cleanTitle}"`);
    await sleep(REQUEST_INTERVAL_MS);
    if (n > 0) return { n, records, usedVariant: variant };
  }
  return { n: 0, records: [], usedVariant: title };
}

async function processBook(book) {
  const authorTokens = splitAuthors(book.author);
  const hasIsbn = !!book.isbn;

  if (hasIsbn) {
    const byIsbn = await lookupByIsbn(book.isbn);
    if (byIsbn.n > 0) {
      const result = disambiguate(byIsbn.records, authorTokens);
      if (result.status !== 'not_found') return { ...result, source: 'ndl_isbn', book };
    }
    // ISBNで見つからない場合はタイトルへフォールバック
    const byTitle = await lookupByTitle(book.title);
    const result = disambiguate(byTitle.records, authorTokens);
    return { ...result, source: 'ndl_title_fallback', book };
  }

  const byTitle = await lookupByTitle(book.title);
  const result = disambiguate(byTitle.records, authorTokens);
  return { ...result, source: 'ndl_title', book };
}

async function main() {
  const db = new Database(resolveDbPath(), { readonly: true });

  // グループA: isbnが実在する本（文字列"null"は既知の別バグのため除外＝グループB扱い）
  const groupA = db
    .prepare(
      "SELECT id, title, author, publisher, isbn FROM books WHERE status != 'deleted' AND isbn IS NOT NULL AND isbn != '' AND isbn != 'null' ORDER BY RANDOM() LIMIT ?"
    )
    .all(GROUP_A_SIZE);

  // グループB: isbnが無い本（真のNULL、空文字、文字列"null"のいずれも含む）
  const groupB = db
    .prepare(
      "SELECT id, title, author, publisher, isbn FROM books WHERE status != 'deleted' AND (isbn IS NULL OR isbn = '' OR isbn = 'null') ORDER BY RANDOM() LIMIT ?"
    )
    .all(GROUP_B_SIZE);

  db.close();

  console.log(`グループA（isbn既知）${groupA.length}件、グループB（isbn不明）${groupB.length}件を処理します...`);

  const results = { A: [], B: [] };
  for (const book of groupA) {
    process.stdout.write('.');
    results.A.push(await processBook(book));
  }
  console.log('\nグループA完了');
  for (const book of groupB) {
    process.stdout.write('.');
    results.B.push(await processBook({ ...book, isbn: null }));
  }
  console.log('\nグループB完了');

  function summarize(label, list, totalInCorpus) {
    const matched = list.filter((r) => r.status === 'matched');
    const needsReview = list.filter((r) => r.status === 'needs_review');
    const notFound = list.filter((r) => r.status === 'not_found');
    const matchedWithNdc = matched.filter((r) => r.ndcCodes && r.ndcCodes.length > 0);
    const matchedNoNdc = matched.filter((r) => !(r.ndcCodes && r.ndcCodes.length > 0));

    console.log(`\n===== ${label}（サンプル${list.length}件） =====`);
    console.log(`  matched: ${matched.length}件（うちNDC付与 ${matchedWithNdc.length}件 / NDC欠落 ${matchedNoNdc.length}件）`);
    console.log(`  needs_review（複数候補のまま）: ${needsReview.length}件`);
    console.log(`  not_found（見つからない）: ${notFound.length}件`);
    const failRate = ((needsReview.length + notFound.length) / list.length) * 100;
    console.log(`  「見つからない＋複数のまま」割合: ${failRate.toFixed(1)}%`);
    if (totalInCorpus) {
      console.log(`  蔵書全体換算（${totalInCorpus}冊とした場合の概算失敗件数）: 約${Math.round((failRate / 100) * totalInCorpus)}冊`);
    }
    return { matched, needsReview, notFound, matchedWithNdc, matchedNoNdc, failRate };
  }

  const summaryA = summarize('グループA（isbn既知）', results.A, groupA.length);
  const summaryB = summarize('グループB（isbn不明・"null"文字列含む）', results.B, groupB.length);

  console.log('\n===== needs_review / not_found の詳細（人間レビューが必要になる例） =====');
  for (const label of ['A', 'B']) {
    for (const r of results[label]) {
      if (r.status !== 'matched') {
        console.log(`  [${label}/${r.status}] ${r.book.title}（著者: ${r.book.author}）source=${r.source}${r.candidateCount ? ` candidates=${r.candidateCount}` : ''}${r.conflictingNdc ? ` conflictingNdc=${JSON.stringify(r.conflictingNdc)}` : ''}`);
      }
    }
  }

  console.log('\n===== 全体推定（グループA/Bの比率を実際の蔵書構成 46%/54% で加重平均） =====');
  const weightedFailRate = summaryA.failRate * 0.46 + summaryB.failRate * 0.54;
  console.log(`  加重平均「見つからない＋複数のまま」割合: ${weightedFailRate.toFixed(1)}%（目標: 3%以下）`);
}

main();
