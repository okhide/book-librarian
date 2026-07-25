// spike S9: Gemini APIの疎通確認、構造化出力(responseSchema)の可否、
// レート制限の実挙動を確認する。
process.loadEnvFile('.env');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-flash-lite-latest';

async function generateText(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json.candidates[0].content.parts[0].text;
}

async function generateStructured(prompt, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json.candidates[0].content.parts[0].text;
}

async function main() {
  console.log('--- 1. 基本的な疎通確認 ---');
  const t0 = Date.now();
  const text = await generateText('こんにちは、と一言だけ日本語で返してください。');
  console.log(`応答(${Date.now() - t0}ms):`, text);

  console.log('\n--- 2. 構造化出力(responseSchema)の確認 ---');
  const schema = {
    type: 'object',
    properties: {
      topics: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['topics'],
  };
  const structured = await generateStructured(
    '次のキーワードを3〜5個の大分類トピックに分類してください。キーワード: 会計, 簿記, 決算, 英語, リスニング, 量子力学, 相対性理論。トピック名の配列をtopicsフィールドで返してください。',
    schema
  );
  console.log('構造化出力:', structured);
  const parsed = JSON.parse(structured);
  console.log('パース結果:', parsed);

  console.log('\n--- 3. 連続リクエストでのレート制限確認(5件連続) ---');
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    try {
      await generateText(`テスト${i}: 数字の${i}だけ返してください。`);
      times.push({ i, ms: Date.now() - start, ok: true });
    } catch (e) {
      times.push({ i, ms: Date.now() - start, ok: false, error: e.message });
    }
  }
  console.log(times);
}

main().catch((e) => {
  console.error('エラー:', e.message);
  process.exit(1);
});
