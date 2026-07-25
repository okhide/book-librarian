// output_data/*.md の1ファイルをパースする純粋関数群。
// 実データ調査（doc/03_specification.md参照）で判明した以下の前提に基づく:
// - フロントマターは単純なkey: "value" / key: null / key: [...] / key: 数値 の1行形式のみ
// - "1. 画面右側から取得した初期要約" が長い要約(summary_long)、
//   "2. プロンプト回答（詳細要約）" が短い要約(summary_short) （見出し名と実際の長さは逆）
// - summary_longが「（要約カードが利用できなかったため取得できませんでした）」等の
//   取得失敗プレースホルダになっている本が僅かに存在する

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const SECTION1_RE = /(?:^|\n)#\s*1\.\s*画面右側から取得した初期要約\s*\n([\s\S]*?)(?=\n#\s*2\.)/;
const SECTION2_RE = /(?:^|\n)#\s*2\.\s*プロンプト回答（詳細要約）\s*\n([\s\S]*?)(?=\n```json)/;

const SUMMARY_PLACEHOLDER_RE = /要約カードが利用できなかった|取得できませんでした/;

const FRONTMATTER_KEYS = [
  'title', 'author', 'publisher', 'series', 'edition', 'isbn',
  'publication_date', 'keywords', 'category', 'reliability', 'url', 'date',
];

/**
 * フロントマターのkey: value 1行を解釈する。
 * 値は "文字列" | null | [配列] | 数値 のいずれか。
 */
function parseScalarValue(raw) {
  const value = raw.trim();
  if (value === 'null') return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function parseKeywordsValue(raw) {
  const m = /^\[(.*)\]$/.exec(raw.trim());
  if (!m) return { keywords: [], warning: `keywordsの配列形式を解釈できなかった: ${raw}` };
  const items = [...m[1].matchAll(/"([^"]*)"/g)].map((mm) => mm[1]);
  return { keywords: items, warning: null };
}

/**
 * フロントマター本文（--- と --- の間）を解釈してオブジェクトを返す。
 * 未知の行は無視し、warningsに記録する。
 */
export function parseFrontmatter(bodyText) {
  const fields = {};
  const warnings = [];
  const lines = bodyText.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) {
      warnings.push(`フロントマターの行を解釈できなかった: ${line}`);
      continue;
    }
    const [, key, rawValue] = m;
    if (!FRONTMATTER_KEYS.includes(key)) {
      warnings.push(`未知のフロントマターキー: ${key}`);
      fields[key] = parseScalarValue(rawValue);
      continue;
    }
    if (key === 'keywords') {
      const { keywords, warning } = parseKeywordsValue(rawValue);
      fields.keywords = keywords;
      if (warning) warnings.push(warning);
    } else {
      fields[key] = parseScalarValue(rawValue);
    }
  }

  return { fields, warnings };
}

/**
 * publication_date文字列から西暦年を抽出する（ベストエフォート）。
 * 実データには以下の書式が混在するため多段フォールバックで解釈する:
 *   アラビア数字年（"2020年6月19日" 等）、漢数字年（"二〇一二年四月二〇日"）、
 *   和暦（"令和5年6月30日" 等）、ISO日付、英語日付、単なる4桁年、"Copyright 2012" 等
 * 解釈できない場合は null を返す（この列は補助的な絞り込み用途のため、無理に推測しない）。
 */
const KANJI_DIGITS = { '〇': '0', '○': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9' };
const ERA_START_YEAR = { 令和: 2019, 平成: 1989, 昭和: 1926, 大正: 1912, 明治: 1868 };

export function extractPublicationYear(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  // 和暦（例: "令和5年6月30日", "平成28年4月25日初版発行"）
  const eraMatch = /(令和|平成|昭和|大正|明治)(\d+|元)年/.exec(dateStr);
  if (eraMatch) {
    const [, era, yearStr] = eraMatch;
    const n = yearStr === '元' ? 1 : Number(yearStr);
    return ERA_START_YEAR[era] + (n - 1);
  }

  // 漢数字の西暦（例: "二〇一二年四月二〇日"）。年の部分だけを漢数字→アラビア数字変換する。
  const kanjiMatch = /^([〇○一二三四五六七八九]{2,4})年/.exec(dateStr.trim());
  if (kanjiMatch) {
    const arabic = kanjiMatch[1].split('').map((c) => KANJI_DIGITS[c] ?? '').join('');
    if (arabic.length === 4 && /^\d{4}$/.test(arabic)) return Number(arabic);
  }

  // アラビア数字4桁の年を含む一般的な書式
  // (西暦年の"年"表記、ISO日付、英語日付、"Copyright 2012"、単なる"2018"等を広くカバーする)
  const arabicMatch = /\b(19|20)\d{2}\b/.exec(dateStr);
  if (arabicMatch) return Number(arabicMatch[0]);

  return null;
}

/**
 * 1冊分のMarkdown全文をパースする。
 * @param {string} rawText
 * @param {{fileName?: string}} [options] fileNameはtitleがnullだった場合の代用に使う
 * @returns {{ok:true, data:object, warnings:string[]} | {ok:false, reason:string}}
 */
export function parseBookMarkdown(rawText, options = {}) {
  const fmMatch = FRONTMATTER_RE.exec(rawText);
  if (!fmMatch) {
    return { ok: false, reason: 'フロントマター（--- ... ---）が見つからない' };
  }
  const { fields, warnings } = parseFrontmatter(fmMatch[1]);

  let title = fields.title && fields.title.trim() ? fields.title.trim() : null;
  let titleIsFallback = false;
  if (!title) {
    if (!options.fileName) {
      return { ok: false, reason: 'titleが空、または存在しない（fileNameの代用も指定されていない)' };
    }
    title = options.fileName.replace(/\.md$/i, '');
    titleIsFallback = true;
    warnings.push('titleが元データでnullだったため、ファイル名で代替した');
  }

  const s1 = SECTION1_RE.exec(rawText);
  const s2 = SECTION2_RE.exec(rawText);
  if (!s1) {
    return { ok: false, reason: '「1. 画面右側から取得した初期要約」セクションが見つからない' };
  }
  if (!s2) {
    return { ok: false, reason: '「2. プロンプト回答（詳細要約）」セクションが見つからない' };
  }

  const summaryLongRaw = s1[1].trim();
  const summaryShort = s2[1].trim();

  let summaryLong = summaryLongRaw;
  let summaryLongIsFallback = false;
  if (SUMMARY_PLACEHOLDER_RE.test(summaryLongRaw)) {
    summaryLong = summaryShort;
    summaryLongIsFallback = true;
    warnings.push('summary_longが取得失敗プレースホルダだったためsummary_shortで代替した');
  }

  const publicationYear = extractPublicationYear(fields.publication_date);

  const data = {
    title,
    titleIsFallback,
    author: fields.author ?? null,
    publisher: fields.publisher ?? null,
    series: fields.series ?? null,
    edition: fields.edition ?? null,
    isbn: fields.isbn ?? null,
    publicationDate: fields.publication_date ?? null,
    publicationYear,
    keywords: fields.keywords ?? [],
    categoryRaw: fields.category ?? null,
    reliability: fields.reliability ?? null,
    driveUrl: fields.url ?? null,
    summarizedAt: fields.date ?? null,
    summaryLong,
    summaryShort,
    summaryLongIsFallback,
  };

  return { ok: true, data, warnings };
}
