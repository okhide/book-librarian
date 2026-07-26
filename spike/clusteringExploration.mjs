// spike S10: k-meansのクラスタ数を変えて結果の解釈可能性を評価する。
// 使い方: node spike/clusteringExploration.mjs [k1,k2,...]
import Database from 'better-sqlite3';
import { resolveDbPath } from '../src/cli/dbPath.js';
import { loadAllEmbeddings } from '../src/lib/vectorSearch.js';
import { kMeans } from '../src/lib/clustering.js';

const ks = (process.argv[2] ?? '8,12,16,20,25').split(',').map(Number);

const db = new Database(resolveDbPath(), { readonly: true });
const embeddings = loadAllEmbeddings(db);
const vectors = embeddings.map((e) => e.vector);
const bookIds = embeddings.map((e) => e.bookId);

const getBook = db.prepare('SELECT title FROM books WHERE id = ?');
const getTopics = db.prepare('SELECT topic FROM book_topics WHERE book_id = ?');

for (const k of ks) {
  console.log(`\n========== k=${k} ==========`);
  const { assignments } = kMeans(vectors, k, { seed: 42 });
  const groups = Array.from({ length: k }, () => []);
  for (let i = 0; i < assignments.length; i++) groups[assignments[i]].push(bookIds[i]);

  groups
    .map((g, idx) => ({ idx, g }))
    .sort((a, b) => b.g.length - a.g.length)
    .forEach(({ idx, g }) => {
      const topicCounts = new Map();
      for (const bookId of g) {
        for (const { topic } of getTopics.all(bookId)) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
      }
      const topTopics = [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, c]) => `${t}(${c})`)
        .join('、');
      const sampleTitles = g.slice(0, 4).map((id) => getBook.get(id)?.title);
      console.log(`  クラスタ${idx}（${g.length}件）主なトピック: ${topTopics}`);
      for (const t of sampleTitles) console.log(`    - ${t}`);
    });
}

db.close();
