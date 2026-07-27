import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPage, resultsFragment, readingStatusForm, bookDetailPage } from '../../src/viewer/views.js';

test('searchPage', async (t) => {
  await t.test('カテゴリ・トピックの<option>が二重エスケープされずにそのままタグとして出る', () => {
    const out = searchPage({ categories: ['ビジネス書'], topics: ['会計'] });
    assert.ok(out.includes('<option value="ビジネス書">ビジネス書</option>'));
    assert.ok(out.includes('<option value="会計">会計</option>'));
    assert.ok(!out.includes('&lt;option'), 'optionタグが二重エスケープされている');
  });
});

test('resultsFragment', async (t) => {
  await t.test('0件の場合は該当なしメッセージを返す', () => {
    const out = resultsFragment(0, [], new Map());
    assert.match(out, /見つかりません/);
  });

  await t.test('タイトルにHTML特殊文字が含まれてもエスケープされる（XSS対策）', () => {
    const results = [
      {
        book: { id: 1, file_path: 'a.md', title: '<script>alert(1)</script>', author: null, category_raw: null, publication_year: null, summary_short: null },
        matchedByKeyword: true,
      },
    ];
    const out = resultsFragment(1, results, new Map());
    assert.ok(!out.includes('<script>alert(1)</script>'));
    assert.ok(out.includes('&lt;script&gt;'));
  });

  await t.test('意味検索のみの結果には実タグとしてバッジが付く（エスケープされたタグ文字列ではない）', () => {
    const results = [
      {
        book: { id: 1, file_path: 'a.md', title: 'タイトル', author: null, category_raw: null, publication_year: null, summary_short: null },
        matchedByKeyword: false,
      },
    ];
    const out = resultsFragment(1, results, new Map());
    assert.ok(out.includes('<span class="badge semantic">意味検索のみ</span>'));
    assert.ok(!out.includes('&lt;span'), 'バッジが二重エスケープされている');
  });

  await t.test('reading_statusがある本には実タグとしてステータスバッジが付く（エスケープされたタグ文字列ではない）', () => {
    const results = [
      {
        book: { id: 1, file_path: 'a.md', title: 'タイトル', author: null, category_raw: null, publication_year: null, summary_short: null },
        matchedByKeyword: true,
      },
    ];
    const readingStatusByFilePath = new Map([['a.md', { status: 'finished' }]]);
    const out = resultsFragment(1, results, readingStatusByFilePath);
    assert.ok(out.includes('<span class="badge">読了</span>'));
    assert.ok(!out.includes('&lt;span'), 'バッジが二重エスケープされている');
  });
});

test('readingStatusForm', async (t) => {
  await t.test('現在のstatusがselectedになる', () => {
    const out = readingStatusForm(1, { status: 'reading', rating: 4, note: 'メモ' });
    assert.ok(out.includes('<option value="reading" selected>読書中</option>'));
    assert.ok(!out.includes('&lt;option'), 'optionタグが二重エスケープされている');
  });

  await t.test('reading_statusが無い場合はunreadが既定でselectedになる', () => {
    const out = readingStatusForm(1, null);
    assert.ok(out.includes('<option value="unread" selected>未読</option>'));
  });

  await t.test('noteにHTMLが含まれてもエスケープされる（XSS対策）', () => {
    const out = readingStatusForm(1, { status: 'unread', rating: null, note: '<img src=x onerror=alert(1)>' });
    assert.ok(!out.includes('<img src=x'));
  });
});

test('bookDetailPage', async (t) => {
  const baseBook = {
    id: 1,
    title: '本のタイトル',
    author: '著者',
    publisher: '出版社',
    publication_year: 2020,
    reader_level: 'beginner',
    summary_long: '長い要約',
    summary_short: '短い要約',
    drive_url: null,
  };

  await t.test('drive_urlが無ければリンクを出さない', () => {
    const out = bookDetailPage(baseBook, [], [], null);
    assert.ok(!out.includes('target="_blank"'));
  });

  await t.test('drive_urlがあればクリック可能なリンクとして出す', () => {
    const out = bookDetailPage({ ...baseBook, drive_url: 'https://drive.google.com/x' }, [], [], null);
    assert.ok(out.includes('<a class="drive-link" href="https://drive.google.com/x" target="_blank"'));
  });

  await t.test('閲覧モードでは長い要約・短い要約の本文がそのまま表示される（[object Object]にならない）', () => {
    const out = bookDetailPage(baseBook, [], [], null);
    assert.ok(!out.includes('[object Object]'), '要約がraw()の二重ラップで壊れている');
    assert.ok(out.includes('<p>長い要約</p>'));
    assert.ok(out.includes('<p>短い要約</p>'));
    assert.ok(!out.includes('<p><p>'), '要約が<p>で二重に囲まれている');
  });

  await t.test('長い要約の改行は段落・改行タグに変換される', () => {
    const out = bookDetailPage({ ...baseBook, summary_long: '1段落目\n\n2段落目\n続き' }, [], [], null);
    assert.ok(out.includes('<p>1段落目</p><p>2段落目<br>続き</p>'));
  });

  await t.test('長い要約の`### 見出し`は<h4>になる', () => {
    const out = bookDetailPage({ ...baseBook, summary_long: '前文\n\n### 主要なテーマ\n\n本文' }, [], [], null);
    assert.ok(out.includes('<h4>主要なテーマ</h4>'));
  });

  await t.test('長い要約の`**太字**`は<strong>になる', () => {
    const out = bookDetailPage({ ...baseBook, summary_long: 'これは**重要**な部分です' }, [], [], null);
    assert.ok(out.includes('<p>これは<strong>重要</strong>な部分です</p>'));
  });

  await t.test('長い要約の`* 箇条書き`は<ul><li>になる（連続する行はまとめて1つのリストにする）', () => {
    const out = bookDetailPage(
      { ...baseBook, summary_long: '* 項目1\n* **項目2**: 説明\n\n次の段落' },
      [], [], null
    );
    assert.ok(out.includes('<ul><li>項目1</li><li><strong>項目2</strong>: 説明</li></ul>'));
    assert.ok(out.includes('<p>次の段落</p>'));
  });

  await t.test('長い要約の`1. 番号付きリスト`は<ol><li>になる', () => {
    const out = bookDetailPage({ ...baseBook, summary_long: '1. 最初\n2. 次' }, [], [], null);
    assert.ok(out.includes('<ol><li>最初</li><li>次</li></ol>'));
  });

  await t.test('要約中の記号がHTMLタグとして解釈される前にエスケープされる（XSS対策）', () => {
    const out = bookDetailPage({ ...baseBook, summary_long: '<script>alert(1)</script>と**太字**' }, [], [], null);
    assert.ok(!out.includes('<script>alert(1)</script>'));
    assert.ok(out.includes('&lt;script&gt;'));
    assert.ok(out.includes('<strong>太字</strong>'));
  });

  await t.test('編集モードでは要約がtextareaで編集できる（[object Object]にならない）', () => {
    const out = bookDetailPage(baseBook, [], [], null, { mode: 'edit' });
    assert.ok(!out.includes('[object Object]'));
    assert.ok(out.includes('<textarea name="summaryLong" rows="14">長い要約</textarea>'));
  });
});
