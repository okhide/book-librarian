// ローカル埋め込みモデル(Xenova/multilingual-e5-small)のラッパー。
// spike S5/S6(spike/s05_s06_embedding_model.js)での実測に基づく選定:
// - 次元数384、2回目以降のロードは1秒未満
// - 日本語での意味的類似度分離を確認済み（「ルネサンス期の食文化」等の字面不一致ケースも含む）
// E5系モデルは接頭辞(passage:/query:)の付与が前提の学習をされているため、
// 蔵書側とクエリ側で異なる接頭辞を付けること（付け忘れると精度が落ちる）。
import path from 'node:path';
import { pipeline, env } from '@huggingface/transformers';

// 既定ではnode_modules内にキャッシュされるが、node_modulesの再インストールで
// 消えてしまうため、doc/04_design.mdのフォルダ構成で定めたdata/models/に固定する。
env.cacheDir = path.resolve('data/models/');

export const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';
export const EMBEDDING_DIM = 384;

export function toPassageText(text) {
  return `passage: ${text}`;
}

export function toQueryText(text) {
  return `query: ${text}`;
}

/**
 * 埋め込みモデルをロードする（1回だけロードして再利用することを想定）。
 * dtype='q8'（量子化版、約113MB）を既定にする。spike S5b実測でfp32（449MB）との
 * 精度差はほぼ無く（分離幅0.093 vs 0.097）、速度は明確に速い（4.7ms/件）ため。
 */
export async function createEmbedder(modelId = DEFAULT_MODEL) {
  return pipeline('feature-extraction', modelId, { dtype: 'q8' });
}

/**
 * テキストを埋め込みベクトルにする。正規化済み(ノルム1)のFloat32Arrayを返すため、
 * コサイン類似度の計算は内積だけで済む。
 */
export async function embedText(extractor, text) {
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Float32Array.from(output.data);
}
