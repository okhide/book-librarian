import path from 'node:path';

/** LIBRARIAN_DB_PATH環境変数でDBパスを上書きできる（テストで本番DBを使わないため）。 */
export function resolveDbPath() {
  return process.env.LIBRARIAN_DB_PATH
    ? path.resolve(process.env.LIBRARIAN_DB_PATH)
    : path.resolve('data/db/library.db');
}
