// spike S7: Float32Array <-> SQLite BLOB の往復で値が保たれるか確認する。
import Database from 'better-sqlite3';
import { floatArrayToBlob, blobToFloatArray } from '../src/lib/vectorBlob.js';

const db = new Database(':memory:');
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v BLOB)');

const original = new Float32Array([0.1, -0.2, 0.30000001, 1, -1, 0]);
const blob = floatArrayToBlob(original);
console.log('BLOBサイズ(bytes):', blob.length, '期待値:', original.length * 4);

db.prepare('INSERT INTO t (id, v) VALUES (1, ?)').run(blob);
const row = db.prepare('SELECT v FROM t WHERE id = 1').get();
const restored = blobToFloatArray(row.v);

console.log('元:', Array.from(original));
console.log('復元:', Array.from(restored));
console.log('完全一致:', Array.from(original).every((v, i) => v === restored[i]));

db.close();
