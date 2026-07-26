// k-means法による蔵書クラスタリング（doc/02_use_cases.md UC11）。
// 追加の依存を増やさず自前で実装する（k=25程度、2,527件×384次元なら十分軽い）。
// ベクトルは正規化済み（単位ベクトル）のため、二乗ユークリッド距離の最小化は
// コサイン類似度の最大化と等価（||a-b||^2 = 2 - 2cos(a,b)）。決定性のため
// 乱数はシード付きの自前PRNG（mulberry32）を使う。
import { loadAllEmbeddings } from './vectorSearch.js';

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function squaredDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function nearestCentroidIndex(vector, centroids) {
  let best = 0;
  let bestDist = Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const d = squaredDistance(vector, centroids[c]);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { index: best, distance: bestDist };
}

// k-means++: 既存の重心から遠い点ほど選ばれやすくすることで、初期化による
// 収束のばらつきを減らす。
function initCentroids(vectors, k, rand) {
  const centroids = [vectors[Math.floor(rand() * vectors.length)]];
  while (centroids.length < k) {
    const distances = vectors.map((v) => {
      let min = Infinity;
      for (const c of centroids) min = Math.min(min, squaredDistance(v, c));
      return min;
    });
    const total = distances.reduce((s, d) => s + d, 0);
    if (total === 0) {
      centroids.push(vectors[Math.floor(rand() * vectors.length)]);
      continue;
    }
    let r = rand() * total;
    let chosen = distances.length - 1;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(vectors[chosen]);
  }
  return centroids;
}

function computeCentroid(vectors, dim) {
  const centroid = new Float64Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) centroid[i] += v[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
  return centroid;
}

/**
 * k-means法（Lloyd's algorithm、k-means++初期化）。決定性のため`seed`固定。
 * @param {Float32Array[]} vectors
 * @param {number} k
 * @param {{seed?: number, maxIterations?: number}} [options]
 * @returns {{assignments: number[], centroids: Float64Array[]}} assignments[i]はvectors[i]の属するクラスタ番号
 */
export function kMeans(vectors, k, options = {}) {
  const { seed = 42, maxIterations = 100 } = options;
  if (vectors.length < k) {
    throw new Error(`クラスタ数(${k})がベクトル数(${vectors.length})を超えています`);
  }
  const dim = vectors[0].length;
  const rand = mulberry32(seed);

  let centroids = initCentroids(vectors, k, rand);
  let assignments = new Array(vectors.length).fill(-1);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    const newAssignments = vectors.map((v) => nearestCentroidIndex(v, centroids).index);
    for (let i = 0; i < newAssignments.length; i++) {
      if (newAssignments[i] !== assignments[i]) changed = true;
    }
    assignments = newAssignments;
    if (!changed && iter > 0) break;

    const groups = Array.from({ length: k }, () => []);
    for (let i = 0; i < vectors.length; i++) groups[assignments[i]].push(vectors[i]);
    centroids = groups.map((g, idx) => (g.length > 0 ? computeCentroid(g, dim) : centroids[idx]));
  }

  return { assignments, centroids };
}

/**
 * 蔵書全体をk-meansでクラスタリングし、各クラスタの規模・主なトピック・代表的な本
 * （重心に近い順）を要約する（doc/02_use_cases.md UC11「蔵書全体の俯瞰」）。
 * build時の永続化は行わず呼び出し時に計算する（実データで数秒程度、Step 7.1の
 * 重複検知と同じ設計方針）。
 * @param {import('better-sqlite3').Database} db
 * @param {{k?: number, seed?: number, sampleSize?: number}} [options]
 * @returns {Array<{clusterIndex:number, size:number, topTopics:Array<{topic:string,count:number}>, representativeBooks:Array<{bookId:number,title:string}>}>} sizeの降順
 */
export function summarizeClusters(db, options = {}) {
  const { k = 20, seed = 42, sampleSize = 4 } = options;

  const embeddings = loadAllEmbeddings(db);
  const vectors = embeddings.map((e) => e.vector);
  const { assignments, centroids } = kMeans(vectors, k, { seed });

  const groups = Array.from({ length: k }, () => []);
  for (let i = 0; i < assignments.length; i++) {
    groups[assignments[i]].push(embeddings[i]);
  }

  const getBook = db.prepare('SELECT title FROM books WHERE id = ?');
  const getTopics = db.prepare('SELECT topic FROM book_topics WHERE book_id = ?');

  return groups
    .map((members, idx) => {
      const topicCounts = new Map();
      for (const m of members) {
        for (const { topic } of getTopics.all(m.bookId)) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
      }
      const topTopics = [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([topic, count]) => ({ topic, count }));

      const centroid = centroids[idx];
      const representativeBooks = [...members]
        .sort((a, b) => squaredDistance(a.vector, centroid) - squaredDistance(b.vector, centroid))
        .slice(0, sampleSize)
        .map((m) => ({ bookId: m.bookId, title: getBook.get(m.bookId)?.title }));

      return { clusterIndex: idx, size: members.length, topTopics, representativeBooks };
    })
    .sort((a, b) => b.size - a.size);
}
