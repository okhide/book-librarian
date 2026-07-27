import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, escapeHtml } from '../../src/viewer/html.js';

test('escapeHtml', async (t) => {
  await t.test('& < > " \' をエスケープする', () => {
    assert.equal(escapeHtml(`<a href="x">a & b's</a>`), '&lt;a href=&quot;x&quot;&gt;a &amp; b&#39;s&lt;/a&gt;');
  });
});

test('html タグ付きテンプレート', async (t) => {
  await t.test('補間値を既定でエスケープする（XSS対策）', () => {
    const title = '<script>alert(1)</script>';
    const out = html`<h1>${title}</h1>`;
    assert.equal(out, '<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>');
  });

  await t.test('raw()でマークした値はエスケープしない', () => {
    const fragment = raw('<span class="badge">既読</span>');
    const out = html`<div>${fragment}</div>`;
    assert.equal(out, '<div><span class="badge">既読</span></div>');
  });

  await t.test('null/undefinedは空文字になる', () => {
    assert.equal(html`<p>${null}${undefined}</p>`, '<p></p>');
  });

  await t.test('配列はそれぞれをstringify後に連結する（rawとの混在も可）', () => {
    const rows = [raw('<li>a</li>'), raw('<li>b</li>')];
    const out = html`<ul>${rows}</ul>`;
    assert.equal(out, '<ul><li>a</li><li>b</li></ul>');
  });

  await t.test('配列の要素が生文字列ならエスケープされる', () => {
    const out = html`<ul>${['<b>x</b>', 'y']}</ul>`;
    assert.equal(out, '<ul>&lt;b&gt;x&lt;/b&gt;y</ul>');
  });
});
