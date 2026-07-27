// ビューア/エディタのHTML断片を組み立てる。エスケープはhtml.jsのタグ付きテンプレートに任せる
// （蔵書データ・reading_status.noteはユーザー/外部データ由来のためエスケープ必須）。
import { html, raw, escapeHtml } from './html.js';

const STATUS_LABELS = {
  unread: '未読',
  reading: '読書中',
  finished: '読了',
  abandoned: '中断',
};

export const LEVEL_LABELS = {
  beginner: '初級',
  intermediate: '中級',
  advanced: '上級',
};

function textOrPlaceholder(value) {
  return value === null || value === undefined || value === '' ? '（未設定）' : value;
}

function boolLabel(value) {
  return value ? 'はい' : 'いいえ';
}

/** `**太字**` をエスケープ済みの行に対して適用する（呼び出し側で既にescapeHtml済みの前提）。 */
function renderInlineMarkdown(escapedLine) {
  return escapedLine.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * 要約本文（Geminiが生成する簡易マークダウン: `### 見出し`・`* 箇条書き`・`1. 番号付き`・
 * `**太字**`）を軽量に整形する。エスケープ後に構文記号を見てタグへ変換するだけの簡易パーサーで、
 * 外部Markdownライブラリは使わない（依存を増やさない方針、doc/04_design.md参照）。
 */
function formatLongText(text) {
  if (!text) return raw('');
  const escaped = escapeHtml(text);
  const lines = escaped.split('\n');

  const htmlParts = [];
  let paragraphLines = [];
  let listItems = [];
  let listTag = null;

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      htmlParts.push(`<p>${paragraphLines.join('<br>')}</p>`);
      paragraphLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      htmlParts.push(`<${listTag}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${listTag}>`);
      listItems = [];
      listTag = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const headerMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headerMatch) {
      flushParagraph();
      flushList();
      htmlParts.push(`<h4>${renderInlineMarkdown(headerMatch[1])}</h4>`);
      continue;
    }

    const bulletMatch = line.match(/^[*・]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      if (listTag !== 'ul') {
        flushList();
        listTag = 'ul';
      }
      listItems.push(renderInlineMarkdown(bulletMatch[1]));
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      if (listTag !== 'ol') {
        flushList();
        listTag = 'ol';
      }
      listItems.push(renderInlineMarkdown(numberedMatch[1]));
      continue;
    }

    flushList();
    paragraphLines.push(renderInlineMarkdown(line));
  }
  flushParagraph();
  flushList();

  return raw(htmlParts.join(''));
}

/** 編集モードなら入力欄、閲覧モードなら値だけを出す1行分の`<tr>`。 */
function fieldRow(label, key, value, mode, opts = {}) {
  const { type = 'text', options, rows = 4, min, max } = opts;

  if (mode !== 'edit') {
    const displayValue =
      type === 'select' && options ? (options.find(([v]) => v === (value ?? '')) ?? [])[1] : textOrPlaceholder(value);
    return html`<tr><th>${label}</th><td>${displayValue ?? textOrPlaceholder(value)}</td></tr>`;
  }

  let input;
  if (type === 'select') {
    const optionTags = options.map(
      ([v, l]) => raw(html`<option value="${v}" ${raw(v === (value ?? '') ? 'selected' : '')}>${l}</option>`)
    );
    input = html`<select name="${key}">${optionTags}</select>`;
  } else if (type === 'textarea') {
    input = html`<textarea name="${key}" rows="${rows}">${value ?? ''}</textarea>`;
  } else if (type === 'number') {
    const minAttr = min != null ? raw(` min="${min}"`) : '';
    const maxAttr = max != null ? raw(` max="${max}"`) : '';
    input = html`<input type="number" name="${key}" value="${value ?? ''}"${minAttr}${maxAttr}>`;
  } else {
    input = html`<input type="text" name="${key}" value="${value ?? ''}">`;
  }
  return html`<tr><th>${label}</th><td>${raw(input)}</td></tr>`;
}

/** 常に表示のみ（編集不可）の1行分の`<tr>`。 */
function readonlyRow(label, value) {
  return html`<tr><th>${label}</th><td>${textOrPlaceholder(value)}</td></tr>`;
}

export function layout(title, bodyHtml) {
  return html`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="/htmx.min.js"></script>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  form.search-form { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
  form.search-form input[type="text"] { flex: 1 1 200px; padding: 0.4rem; }
  form.search-form select, form.search-form input[type="number"] { padding: 0.4rem; }
  .book { border-bottom: 1px solid #ddd; padding: 0.75rem 0; }
  .book h3 { margin: 0 0 0.25rem; }
  .book h3 a { color: #0645ad; text-decoration: none; }
  .book .meta { color: #666; font-size: 0.85rem; }
  .badge { display: inline-block; font-size: 0.75rem; padding: 0.1rem 0.4rem; border-radius: 0.25rem; background: #eee; margin-left: 0.4rem; }
  .badge.semantic { background: #e0ecff; }
  .status-panel { border: 1px solid #ddd; border-radius: 0.4rem; padding: 1rem; margin-top: 1rem; }
  .status-panel label { display: block; margin-top: 0.5rem; font-size: 0.9rem; }
  .status-panel textarea { width: 100%; box-sizing: border-box; }
  .back-link { display: inline-block; margin-bottom: 1rem; }
  .drive-link { display: inline-block; margin: 0.5rem 0; }
  .mode-toggle { display: inline-block; float: right; }
  .saved-message { color: #0a7d2c; font-weight: bold; }
  table.book-fields { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; }
  table.book-fields th { text-align: left; color: #555; font-weight: normal; font-size: 0.85rem; vertical-align: top; padding: 0.3rem 0.5rem 0.3rem 0; width: 11rem; }
  table.book-fields td { padding: 0.3rem 0; }
  table.book-fields input[type="text"], table.book-fields input[type="number"], table.book-fields select { width: 100%; box-sizing: border-box; padding: 0.3rem; }
  table.book-fields textarea { width: 100%; box-sizing: border-box; padding: 0.3rem; font-family: inherit; }
  .summary-body h4 { margin: 1rem 0 0.3rem; }
  .summary-body ul, .summary-body ol { margin: 0.3rem 0; padding-left: 1.5rem; }
  .summary-body p { margin: 0.5rem 0; }
</style>
</head>
<body>
${raw(bodyHtml)}
</body>
</html>`;
}

export function searchPage({ categories, topics }) {
  return html`<h1>蔵書検索</h1>
<form class="search-form" hx-get="/search" hx-trigger="input changed delay:300ms, change, submit" hx-target="#results" hx-swap="innerHTML">
  <input type="text" name="q" placeholder="検索語" autofocus>
  <select name="category">
    <option value="">カテゴリ(すべて)</option>
    ${categories.map((c) => raw(html`<option value="${c}">${c}</option>`))}
  </select>
  <select name="topic">
    <option value="">トピック(すべて)</option>
    ${topics.map((t) => raw(html`<option value="${t}">${t}</option>`))}
  </select>
  <select name="level">
    <option value="">読者レベル(すべて)</option>
    <option value="beginner">初級</option>
    <option value="intermediate">中級</option>
    <option value="advanced">上級</option>
  </select>
  <input type="number" name="year" placeholder="出版年">
  <label><input type="checkbox" name="unread" value="on"> 未読のみ</label>
</form>
<div id="results"></div>`;
}

function resultRow(r, readingStatus) {
  const book = r.book;
  const statusBadge = readingStatus
    ? html`<span class="badge">${STATUS_LABELS[readingStatus.status] ?? readingStatus.status}</span>`
    : '';
  const semanticBadge = r.matchedByKeyword ? '' : html`<span class="badge semantic">意味検索のみ</span>`;
  return html`<div class="book">
  <h3><a href="/books/${book.id}">${book.title}</a>${raw(statusBadge)}${raw(semanticBadge)}</h3>
  <div class="meta">${book.author ?? '著者不明'} / ${book.category_raw ?? ''} / ${book.publication_year ?? ''}</div>
  <div>${book.summary_short ?? ''}</div>
</div>`;
}

export function resultsFragment(totalCount, results, readingStatusByFilePath) {
  if (results.length === 0) {
    return html`<p>該当する本が見つかりませんでした。</p>`;
  }
  const rows = results.map((r) => resultRow(r, readingStatusByFilePath.get(r.book.file_path)));
  return html`<p>${totalCount}件ヒット（上位${results.length}件を表示）</p>${rows.map((row) => raw(row))}`;
}

export function readingStatusForm(bookId, readingStatus, message) {
  const status = readingStatus?.status ?? 'unread';
  const rating = readingStatus?.rating ?? '';
  const note = readingStatus?.note ?? '';
  const options = Object.entries(STATUS_LABELS).map(([value, label]) =>
    raw(html`<option value="${value}" ${raw(value === status ? 'selected' : '')}>${label}</option>`)
  );
  return html`<div id="reading-status-panel" class="status-panel"
    hx-post="/books/${bookId}/reading-status" hx-trigger="submit" hx-target="#reading-status-panel" hx-swap="outerHTML">
  <form>
    <label>状態
      <select name="status">${options}</select>
    </label>
    <label>評価(1-5)
      <input type="number" name="rating" min="1" max="5" value="${rating}">
    </label>
    <label>メモ
      <textarea name="note" rows="3">${note}</textarea>
    </label>
    <button type="submit">保存</button>
    ${message ? raw(html`<span>${message}</span>`) : ''}
  </form>
</div>`;
}

export function bookDetailPage(book, keywords, topics, readingStatus, { mode = 'view', saved = false } = {}) {
  const driveLink = book.drive_url
    ? html`<a class="drive-link" href="${book.drive_url}" target="_blank" rel="noopener noreferrer">蔵書本体を開く（Google Drive）</a>`
    : '';

  const modeToggle =
    mode === 'edit'
      ? html`<a class="mode-toggle" href="/books/${book.id}">&#10003; 閲覧モードに戻る</a>`
      : html`<a class="mode-toggle" href="/books/${book.id}?mode=edit">✎ 編集モードに切り替え</a>`;

  const savedMessage = saved ? html`<p class="saved-message">保存しました</p>` : '';

  const levelOptions = [['', '不明'], ...Object.entries(LEVEL_LABELS)];

  const bibliographyRows = [
    fieldRow('タイトル', 'title', book.title, mode),
    fieldRow('著者', 'author', book.author, mode),
    fieldRow('出版社', 'publisher', book.publisher, mode),
    fieldRow('シリーズ', 'series', book.series, mode),
    fieldRow('版', 'edition', book.edition, mode),
    fieldRow('ISBN', 'isbn', book.isbn, mode),
    fieldRow('出版日', 'publicationDate', book.publication_date, mode),
    fieldRow('出版年', 'publicationYear', book.publication_year, mode, { type: 'number' }),
    fieldRow('カテゴリ（元データの自由記述）', 'categoryRaw', book.category_raw, mode),
    fieldRow('信頼度スコア(0-3)', 'reliability', book.reliability, mode, { type: 'number', min: 0, max: 3 }),
    fieldRow('蔵書本体リンク(URL)', 'driveUrl', book.drive_url, mode),
    fieldRow('読者レベル', 'readerLevel', book.reader_level, mode, { type: 'select', options: levelOptions }),
  ].map((r) => raw(r));

  const summaryRows = [
    fieldRow('短い要約', 'summaryShort', book.summary_short, mode, { type: 'textarea', rows: 3 }),
    fieldRow('長い要約', 'summaryLong', book.summary_long, mode, { type: 'textarea', rows: 14 }),
  ].map((r) => raw(r));

  const summaryView =
    mode === 'edit'
      ? ''
      : html`<h2>要約</h2>
<div class="summary-body">${formatLongText(book.summary_short)}</div>
<h3>詳しい要約</h3>
<div class="summary-body">${formatLongText(book.summary_long ?? book.summary_short)}</div>`;

  const editForm = html`<form method="POST" action="/books/${book.id}/edit${raw(mode === 'edit' ? '?mode=edit' : '')}">
<h2>書誌情報</h2>
<table class="book-fields">${bibliographyRows}</table>
${mode === 'edit' ? raw(html`<h2>要約（編集）</h2><table class="book-fields">${summaryRows}</table><button type="submit">保存</button>`) : ''}
</form>`;

  const classificationRows = [
    readonlyRow('キーワード（自動生成・編集不可）', keywords.join('、') || null),
    readonlyRow('トピック（自動生成・編集不可）', topics.join('、') || null),
    readonlyRow('タイトルは代用値か', boolLabel(book.title_is_fallback)),
    readonlyRow('長い要約は代用値か', boolLabel(book.summary_long_is_fallback)),
    readonlyRow('読者レベルの判定元', book.reader_level_source),
  ].map((r) => raw(r));

  const enrichmentRows = [
    readonlyRow('ISBN・NDC補完ステータス', book.enrichment_status),
    readonlyRow('補完されたISBN', book.enriched_isbn),
    readonlyRow('補完されたNDC', book.enriched_ndc),
    readonlyRow('補完データソース', book.enriched_source),
  ].map((r) => raw(r));

  const systemRows = [
    readonlyRow('id', book.id),
    readonlyRow('ファイルパス', book.file_path),
    readonlyRow('状態(status)', book.status),
    readonlyRow('蔵書リスト通し番号', book.csv_serial),
    readonlyRow('蔵書リストファイル名', book.csv_filename),
    readonlyRow('要約取得日時', book.summarized_at),
    readonlyRow('最終更新日時', book.updated_at),
  ].map((r) => raw(r));

  return html`<a class="back-link" href="/">&larr; 検索に戻る</a>
${raw(modeToggle)}
<h1>${book.title}</h1>
${raw(savedMessage)}
${raw(driveLink)}
${raw(editForm)}
${raw(summaryView)}

<h2>キーワード・トピック・分類（自動生成、編集不可）</h2>
<table class="book-fields">${classificationRows}</table>

<h2>ISBN・NDC自動補完（編集不可。<code>node src/cli/enrich.js</code>で確認・修正）</h2>
<table class="book-fields">${enrichmentRows}</table>

<h2>システム情報（編集不可）</h2>
<table class="book-fields">${systemRows}</table>

${raw(readingStatusForm(book.id, readingStatus))}`;
}
