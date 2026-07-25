// トピック分類表の草案をLLMで生成する（Step 3.2）。
// ここで生成するのはあくまで「草案」であり、ユーザーがレビュー・編集して
// 確定させたものだけが data/topic_taxonomy.json として使われる
// （doc/03_specification.md「topicsの生成: 2層構造」参照）。
import { generateStructured } from '../lib/gemini.js';

const TAXONOMY_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
      },
    },
  },
  required: ['topics'],
};

export function buildTaxonomyDraftPrompt(frequentKeywords) {
  const keywordList = frequentKeywords.map((k) => `${k.keyword}(${k.count})`).join(', ');
  return `あなたは個人蔵書（約2,500冊、ビジネス書・技術書・実用書・教養書などを幅広く含む）の分類を手伝う司書です。
以下は蔵書の要約から抽出したキーワードとその出現回数です。これらを手がかりに、蔵書全体を分類するための
「トピック分類表」を80〜150項目程度で設計してください。

要件:
- 各トピックは日本語の短い名前(name)と、どんなキーワード・話題が該当するかの説明(description)を持つこと
- 粒度は「会計」のように具体的すぎず、「ビジネス」のように大雑把すぎない中間的な粒度にすること
  (例: 「会計・財務」「マーケティング」「プログラミング基礎」「語学学習」等)
- キーワード一覧に無い一般的なトピックを補ってもよいが、実際のキーワードに基づいた分類を優先すること
- 重複や意味が近すぎるトピックは避けること

キーワード一覧(頻度順、キーワード(出現回数)):
${keywordList}
`;
}

/** @returns {Promise<{topics: Array<{name: string, description: string}>}>} */
export async function generateTaxonomyDraft(frequentKeywords) {
  const prompt = buildTaxonomyDraftPrompt(frequentKeywords);
  return generateStructured(prompt, TAXONOMY_SCHEMA);
}
