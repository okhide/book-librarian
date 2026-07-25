// Float32Array <-> SQLite BLOB の変換。spike S7でbetter-sqlite3との往復を確認済み。

/** @param {Float32Array} vec */
export function floatArrayToBlob(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** @param {Buffer} blob better-sqlite3から読み出したBLOB */
export function blobToFloatArray(blob) {
  // better-sqlite3が返すBufferは内部バッファを共有している可能性があるため、
  // Float32Arrayが参照する期間を通じて安定させるためコピーする。
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / Float32Array.BYTES_PER_ELEMENT);
}
