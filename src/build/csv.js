// data/蔵書リスト.csv のパースと突き合わせ。
// 実データ調査で判明した前提:
// - UTF-8 with BOM（Shift_JISではない）
// - 列: 通し番号, ファイル名, 更新日時, サイズ, ファイルのリンク（常に5列、カンマ区切りで安全に分割できる。
//   引用符・エンベデッドコンマは存在しない）
// - ファイル名の拡張子は .pdf。output_dataの対応ファイルは同名の .md
// - 更新日時は "Fri Jul 24 2026 21:22:00 GMT+0900 (日本標準時)" 形式。
//   これはJSのDate#toString()と同じ書式なので `new Date(str)` でそのまま解釈できる
// - 同じファイル名が複数行存在するケースがある（重複アップロード等）。
//   その場合は通し番号が最大の行を正とする

/**
 * CSV全文をパースする。
 * @param {string} rawText BOMを含む可能性がある生テキスト
 * @returns {{rows: Array<{csvSerial:number, csvFilename:string, csvUpdatedAt:string, driveUrl:string}>, warnings: string[]}}
 */
export function parseCatalogCsv(rawText) {
  let text = rawText;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const warnings = [];
  if (lines.length === 0) return { rows: [], warnings: ['CSVが空だった'] };

  const rows = [];
  for (const line of lines.slice(1)) {
    const fields = line.split(',');
    if (fields.length !== 5) {
      warnings.push(`列数が5でない行をスキップした: ${line}`);
      continue;
    }
    const [serialStr, filename, updatedAtRaw, , driveUrl] = fields;
    const csvSerial = Number(serialStr);
    if (!Number.isFinite(csvSerial)) {
      warnings.push(`通し番号が数値でない行をスキップした: ${line}`);
      continue;
    }
    const parsedDate = new Date(updatedAtRaw);
    const csvUpdatedAt = Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
    if (csvUpdatedAt === null) {
      warnings.push(`更新日時を解釈できなかった: ${updatedAtRaw}`);
    }

    rows.push({ csvSerial, csvFilename: filename, csvUpdatedAt, driveUrl });
  }

  return { rows, warnings };
}

/** CSVのファイル名（.pdf）をoutput_dataのファイル名（.md）に変換する。 */
export function csvFilenameToMdFilename(csvFilename) {
  return csvFilename.replace(/\.pdf$/i, '.md');
}

/**
 * 同じmdファイル名に複数のCSV行が対応する場合、通し番号が最大の行を正とする。
 * @returns {Map<string, object>} mdファイル名 -> 正とするCSV行
 */
export function pickCanonicalRowsByMdFilename(rows) {
  const canonical = new Map();
  for (const row of rows) {
    const mdFilename = csvFilenameToMdFilename(row.csvFilename);
    const existing = canonical.get(mdFilename);
    if (!existing || row.csvSerial > existing.csvSerial) {
      canonical.set(mdFilename, row);
    }
  }
  return canonical;
}
