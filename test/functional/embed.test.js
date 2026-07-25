// 実際の埋め込みモデルをロードするため、unitではなくfunctionalに置く（初回はモデルDLで時間がかかる）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedder, embedText, toPassageText, toQueryText, EMBEDDING_DIM } from '../../src/lib/embed.js';

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

test('埋め込みモデル', async (t) => {
  const extractor = await createEmbedder();

  await t.test('期待した次元数のベクトルが返る', async () => {
    const vec = await embedText(extractor, toQueryText('テスト'));
    assert.equal(vec.length, EMBEDDING_DIM);
    assert.ok(vec instanceof Float32Array);
  });

  await t.test('同じ入力に対して常に同じ結果を返す（決定性）', async () => {
    const v1 = await embedText(extractor, toPassageText('会計の基本を解説する入門書'));
    const v2 = await embedText(extractor, toPassageText('会計の基本を解説する入門書'));
    assert.deepEqual(Array.from(v1), Array.from(v2));
  });

  await t.test('ベクトルは正規化済み（ノルムがほぼ1）', async () => {
    const vec = await embedText(extractor, toPassageText('テスト用の文章'));
    const norm = Math.sqrt(dot(vec, vec));
    assert.ok(Math.abs(norm - 1) < 1e-4, `ノルムが1から離れている: ${norm}`);
  });

  await t.test('日本語で意味的に近い文章ほど類似度が高くなる', async () => {
    const accounting = await embedText(
      extractor,
      toPassageText('会計の基本的な考え方について、簿記の仕組みから決算書の読み方まで解説する入門書。')
    );
    const bookkeeping = await embedText(
      extractor,
      toPassageText('簿記3級の資格取得を目指す人向けに、仕訳や決算書作成の基礎を説明した参考書。')
    );
    const cooking = await embedText(
      extractor,
      toPassageText('フランス料理の基礎技術を写真付きで解説する。家庭で実践できるレシピを掲載。')
    );
    const query = await embedText(extractor, toQueryText('会計を勉強したい'));

    const simAccounting = dot(query, accounting);
    const simBookkeeping = dot(query, bookkeeping);
    const simCooking = dot(query, cooking);

    assert.ok(simAccounting > simCooking, '会計本が料理本より類似度が高くない');
    assert.ok(simBookkeeping > simCooking, '簿記本が料理本より類似度が高くない');
  });

  await t.test('中核仮説: 字面が一致しないニッチな話題でも意味で拾える', async () => {
    const renaissance = await embedText(
      extractor,
      toPassageText('16世紀イタリアの宮廷における食卓文化を解説する。当時の食材や調理法、饗宴の様式を史料をもとに描く。')
    );
    const unrelatedTech = await embedText(
      extractor,
      toPassageText('Pythonを使ったデータ分析の基礎を解説する。pandasやNumPyの使い方、機械学習の初歩まで扱う入門書。')
    );
    const query = await embedText(extractor, toQueryText('ルネサンス期の食文化について知りたい'));

    const simRenaissance = dot(query, renaissance);
    const simTech = dot(query, unrelatedTech);

    assert.ok(
      simRenaissance > simTech,
      `字面不一致の関連書が無関係書より類似度が高くない (renaissance=${simRenaissance}, tech=${simTech})`
    );
  });
});
