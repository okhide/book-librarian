// Obsidianノートのファイル名を生成する（doc/06_implementation_plan.md Phase 8）。
// spike S11でWindowsの禁止文字を全角文字に置換する方式が実際にファイル作成・読み込みできることを確認済み。
const WINDOWS_ILLEGAL = /[\\/:*?"<>|]/g;
const FULLWIDTH_MAP = {
  '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？',
  '"': '”', '<': '＜', '>': '＞', '|': '｜',
};
const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * トピック名をWindows/Obsidianで安全なファイル名断片に変換する。
 * @param {string} topic
 * @returns {string}
 */
export function sanitizeTopic(topic) {
  let safe = topic.replace(WINDOWS_ILLEGAL, (ch) => FULLWIDTH_MAP[ch] ?? '');
  safe = safe.replace(/[ .]+$/g, '').trim();
  if (safe === '') {
    throw new Error('トピック名が空、または禁止文字のみで構成されています');
  }
  if (RESERVED_NAME.test(safe)) safe = `_${safe}`;
  return safe;
}

/**
 * 「日付＋トピック名」形式のファイル名を生成する。
 * dateはYYYY-MM-DD形式で受け取り（frontmatterのcreatedと同じ形式に揃える）、
 * ファイル名にはハイフン無しのYYYYMMDD形式で埋め込む（ユーザー指定の命名規則）。
 * @param {{topic: string, date?: string}} params date省略時はローカル日付（YYYY-MM-DD）を使う
 * @returns {string} 例: "20260726_資本論の労働価値説.md"
 */
export function buildFilename({ topic, date }) {
  if (!topic || typeof topic !== 'string') {
    throw new Error('topicは必須の文字列です');
  }
  const d = date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`dateはYYYY-MM-DD形式である必要があります: ${d}`);
  }
  return `${d.replaceAll('-', '')}_${sanitizeTopic(topic)}.md`;
}
