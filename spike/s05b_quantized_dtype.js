// spike S5補足: 量子化モデル(q8)でもfp32と同等の品質が出るか、サイズ・速度を比較する。
import { pipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/multilingual-e5-small';

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function embed(extractor, text) {
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Float32Array.from(output.data);
}

async function run(dtype) {
  console.log(`\n=== dtype: ${dtype} ===`);
  const t0 = Date.now();
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype });
  console.log(`ロード時間: ${Date.now() - t0}ms`);

  const renaissance = await embed(
    extractor,
    'passage: 16世紀イタリアの宮廷における食卓文化を解説する。当時の食材や調理法、饗宴の様式を史料をもとに描く。'
  );
  const unrelatedTech = await embed(
    extractor,
    'passage: Pythonを使ったデータ分析の基礎を解説する。pandasやNumPyの使い方、機械学習の初歩まで扱う入門書。'
  );
  const query = await embed(extractor, 'query: ルネサンス期の食文化について知りたい');

  const simRenaissance = dot(query, renaissance);
  const simTech = dot(query, unrelatedTech);
  console.log(`ルネサンス本との類似度: ${simRenaissance.toFixed(4)}`);
  console.log(`無関係な技術書との類似度: ${simTech.toFixed(4)}`);
  console.log(`分離幅: ${(simRenaissance - simTech).toFixed(4)}`);

  const t1 = Date.now();
  for (let i = 0; i < 20; i++) {
    await embed(extractor, `passage: テスト文章その${i}、性能測定用のダミーテキストです。`);
  }
  console.log(`20件の埋め込み生成時間: ${Date.now() - t1}ms (1件あたり${((Date.now() - t1) / 20).toFixed(1)}ms)`);
}

await run('q8');
