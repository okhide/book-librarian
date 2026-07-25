// spike S1: better-sqlite3 がこのWindows環境でビルド・動作するか検証する
import Database from 'better-sqlite3';

const db = new Database(':memory:');

db.exec(`
  CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL
  );
`);

const insert = db.prepare('INSERT INTO books (title) VALUES (?)');
insert.run('会計の基本');
insert.run('英語入門');

const rows = db.prepare('SELECT * FROM books').all();
console.log('rows:', rows);

const like = db.prepare("SELECT * FROM books WHERE title LIKE '%会計%'").all();
console.log('LIKE match (日本語部分一致):', like);

db.close();
console.log('OK: better-sqlite3 は正常に動作した');
