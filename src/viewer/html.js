// htmxで返すHTML断片を組み立てるための最小限のテンプレートヘルパー。
// 補間値は既定でエスケープする（蔵書タイトル・reading_status.note等ユーザー/外部データ由来の
// 文字列をそのまま埋め込むとXSSになるため）。既に組み立て済みのHTML断片（他のhtml``呼び出しの結果や
// 配列）を埋め込みたい場合はraw()でマークしてエスケープを免除する。

const RAW = Symbol('raw');

export function raw(value) {
  return { [RAW]: true, value: String(value ?? '') };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stringifyValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(stringifyValue).join('');
  if (typeof value === 'object' && value[RAW]) return value.value;
  return escapeHtml(value);
}

/** タグ付きテンプレート。補間値は既定でエスケープし、raw()でマークした値はそのまま挿入する。 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += stringifyValue(values[i]) + strings[i + 1];
  }
  return out;
}
