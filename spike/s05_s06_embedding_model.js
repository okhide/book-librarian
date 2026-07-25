// spike S5/S6: 埋め込みモデルの選定。
// - ダウンロードサイズ、初回/2回目以降のロード時間、次元数
// - 日本語での類似度品質（関連書 vs 無関係書が意味的に分離できるか）
// - E5系の接頭辞(passage:/query:)の有無で結果がどう変わるか
import { pipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/multilingual-e5-small';

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embed(extractor, text) {
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function main() {
  console.log(`モデル: ${MODEL_ID}`);

  const t0 = Date.now();
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
  console.log(`初回ロード(ダウンロード含む): ${Date.now() - t0}ms`);

  const t1 = Date.now();
  const extractor2 = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
  console.log(`2回目ロード(キャッシュ済み): ${Date.now() - t1}ms`);

  // --- 次元数確認 ---
  const sample = await embed(extractor, 'query: テスト');
  console.log(`次元数: ${sample.length}`);

  // --- 日本語での類似度品質（実データ相当の要約文で検証） ---
  const accountingBookA =
    'passage: 会計の基本的な考え方について、簿記の仕組みから決算書の読み方まで幅広く解説している。管理会計や財務諸表の分析手法も紹介する実用的な入門書。';
  const accountingBookB =
    'passage: 簿記3級の資格取得を目指す人向けに、仕訳や決算書作成の基礎を丁寧に説明した参考書。会計の初心者にもわかりやすい。';
  const cookingBook =
    'passage: フランス料理の基礎技術を写真付きで解説する。ソース作りやカット技法など、家庭でも実践できるレシピを多数掲載。';

  const queryWithPrefix = 'query: 会計を勉強したい';
  const queryNoPrefix = '会計を勉強したい';

  const [vecA, vecB, vecCooking] = await Promise.all([
    embed(extractor, accountingBookA),
    embed(extractor, accountingBookB),
    embed(extractor, cookingBook),
  ]);

  const [vecQueryPrefixed, vecQueryPlain] = await Promise.all([
    embed(extractor, queryWithPrefix),
    embed(extractor, queryNoPrefix),
  ]);

  console.log('\n--- 接頭辞あり(query:) ---');
  console.log('会計本A との類似度:', cosineSim(vecQueryPrefixed, vecA).toFixed(4));
  console.log('会計本B との類似度:', cosineSim(vecQueryPrefixed, vecB).toFixed(4));
  console.log('料理本  との類似度:', cosineSim(vecQueryPrefixed, vecCooking).toFixed(4));

  console.log('\n--- 接頭辞なし ---');
  console.log('会計本A との類似度:', cosineSim(vecQueryPlain, vecA).toFixed(4));
  console.log('会計本B との類似度:', cosineSim(vecQueryPlain, vecB).toFixed(4));
  console.log('料理本  との類似度:', cosineSim(vecQueryPlain, vecCooking).toFixed(4));

  // --- 中核仮説の検証: 字面が一致しない「ルネサンスの食文化」ケース ---
  const renaissanceBook =
    'passage: 16世紀イタリアの宮廷における食卓文化を解説する。当時の食材や調理法、饗宴の様式について豊富な史料をもとに描く。';
  const unrelatedTechBook =
    'passage: Pythonを使ったデータ分析の基礎を解説する。pandasやNumPyの使い方、機械学習の初歩まで扱う入門書。';
  const query2 = 'query: ルネサンス期の食文化について知りたい';

  const [vecRenaissance, vecTech, vecQ2] = await Promise.all([
    embed(extractor, renaissanceBook),
    embed(extractor, unrelatedTechBook),
    embed(extractor, query2),
  ]);

  console.log('\n--- 中核仮説: 字面不一致でも意味で拾えるか ---');
  console.log('「ルネサンス期の食文化」 vs 16世紀イタリア食卓文化の本:', cosineSim(vecQ2, vecRenaissance).toFixed(4));
  console.log('「ルネサンス期の食文化」 vs Python入門書:', cosineSim(vecQ2, vecTech).toFixed(4));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
