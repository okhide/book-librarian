// CLIスクリプト間で重複していた引数パース処理を1箇所に集約する。
// 特に数値フラグに非数値/値なしを渡すと`Number(undefined)`が`NaN`になり、
// それがLIMIT句やk-meansのkに黙って伝播して「結果0件」等の誤動作を
// 引き起こす問題があったため、数値系フラグは検証してエラーを投げる。

/**
 * @param {string[]} argv
 * @param {Record<string, {flag: string, type: 'string'|'number'|'boolean'|'numberList'}>} spec
 *   プロパティ名 → { flag: "--foo", type }。
 * @returns {{flags: Record<string, any>, positional: string[]}}
 */
export function parseFlags(argv, spec) {
  const byFlag = new Map(Object.entries(spec).map(([prop, def]) => [def.flag, { prop, ...def }]));
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const def = byFlag.get(arg);
    if (!def) {
      positional.push(arg);
      continue;
    }
    if (def.type === 'boolean') {
      flags[def.prop] = true;
      continue;
    }
    const raw = argv[++i];
    if (raw === undefined) {
      throw new Error(`${arg} には値が必要です`);
    }
    flags[def.prop] = parseValue(arg, raw, def.type);
  }
  return { flags, positional };
}

function parseValue(flag, raw, type) {
  if (type === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`${flag} には数値を指定してください（渡された値: "${raw}"）`);
    return n;
  }
  if (type === 'numberList') {
    const list = raw.split(',').map(Number);
    if (list.some((n) => Number.isNaN(n))) {
      throw new Error(`${flag} には数値のカンマ区切りを指定してください（渡された値: "${raw}"）`);
    }
    return list;
  }
  return raw;
}
