// Gemini API の薄いラッパー。SDK依存を増やさずfetchで直接呼ぶ
// （spike S9で疎通・構造化出力・レート制限を確認済み）。
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEYが設定されていません。.envファイルを確認してください。');
  }
  return key;
}

/**
 * @param {string} prompt
 * @param {object} responseSchema Gemini構造化出力のJSON Schema
 * @param {{model?: string}} [options]
 * @returns {Promise<any>} responseSchemaに従ってパース済みのJSON
 */
export async function generateStructured(prompt, responseSchema, options = {}) {
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${getApiKey()}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema },
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini API エラー HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return JSON.parse(json.candidates[0].content.parts[0].text);
}
