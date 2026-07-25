// 確定したトピック分類表を前提に、全キーワード(8,782語)をバッチでLLMに渡し
// topic_mapping.jsonを生成する（doc/03_specification.md「topicsの生成: 2層構造」）。
// Gemini呼び出し自体はclassifyBatchFnとして注入する設計にし、
// 自動テストでは実APIを呼ばずに済むようにしている。

export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function buildMappingPrompt(batchKeywords, taxonomy) {
  const topicList = taxonomy.topics.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  const keywordList = batchKeywords.join(', ');
  return `以下は蔵書検索システムのトピック分類表です。

${topicList}

次のキーワードそれぞれについて、上記の分類表の中から最も適切なトピック名を1つ選んでください。
キーワード: ${keywordList}

各キーワードについて、以下2点を厳守して mappings 配列で返してください。
1. keywordフィールドには、入力されたキーワードの文字列を1文字も変更せず、
   そのまま（表記の修正・言い換え・敬体変換等をせず）出力すること。
2. topicフィールドには、上記の分類表にある名前を正確にそのまま使うこと
   （表記を変えたり新しい名前を作ったりしないこと）。
また、入力された${batchKeywords.length}件のキーワード全てについて、必ず1件ずつ結果を返すこと
（省略しないこと）。`;
}

const MAPPING_SCHEMA = {
  type: 'object',
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { keyword: { type: 'string' }, topic: { type: 'string' } },
        required: ['keyword', 'topic'],
      },
    },
  },
  required: ['mappings'],
};

/**
 * @param {string[]} batchKeywords
 * @param {{topics: Array<{name: string, description: string}>}} taxonomy
 * @param {(prompt: string, schema: object) => Promise<any>} generateFn 通常はsrc/lib/gemini.jsのgenerateStructured
 * @returns {Promise<{mapping: Record<string, string|null>, invalidCount: number}>}
 */
export async function classifyKeywordBatch(batchKeywords, taxonomy, generateFn) {
  const prompt = buildMappingPrompt(batchKeywords, taxonomy);
  const result = await generateFn(prompt, MAPPING_SCHEMA);
  const validTopics = new Set(taxonomy.topics.map((t) => t.name));

  const mapping = {};
  let invalidCount = 0;
  for (const m of result.mappings) {
    if (validTopics.has(m.topic)) {
      mapping[m.keyword] = m.topic;
    } else {
      invalidCount++;
      mapping[m.keyword] = null; // 分類表に無いトピックを返してきた場合は未分類として扱う
    }
  }

  // LLMがキーワード文字列を書き換えて返す、または省略することがあるため
  // （実データで実際に発生した）、入力した全キーワードが必ずmappingに
  // 含まれることをここで保証する。応答に含まれなかった語はnull(未分類)にする。
  let missingCount = 0;
  for (const keyword of batchKeywords) {
    if (!(keyword in mapping)) {
      mapping[keyword] = null;
      missingCount++;
    }
  }

  return { mapping, invalidCount: invalidCount + missingCount };
}

/**
 * @param {string[]} keywords 全キーワード
 * @param {{topics: Array}} taxonomy
 * @param {{
 *   batchSize?: number,
 *   classifyBatchFn: (batch: string[], taxonomy: object) => Promise<{mapping: object, invalidCount: number}>,
 *   existingMapping?: Record<string, string|null>,
 *   onBatchComplete?: (mapping: Record<string, string|null>) => void
 * }} options
 * @returns {Promise<{mapping: Record<string, string|null>, totalInvalid: number, batchesProcessed: number}>}
 */
export async function generateTopicMapping(keywords, taxonomy, options) {
  const { batchSize = 150, classifyBatchFn, existingMapping = {}, onBatchComplete } = options;

  // 既存の対応表にある語はスキップする（中断・再開のため）
  const remaining = keywords.filter((k) => !(k in existingMapping));
  const batches = chunkArray(remaining, batchSize);

  const mapping = { ...existingMapping };
  let totalInvalid = 0;

  for (const batch of batches) {
    const { mapping: batchMapping, invalidCount } = await classifyBatchFn(batch, taxonomy);
    Object.assign(mapping, batchMapping);
    totalInvalid += invalidCount;
    if (onBatchComplete) onBatchComplete(mapping);
  }

  return { mapping, totalInvalid, batchesProcessed: batches.length };
}
