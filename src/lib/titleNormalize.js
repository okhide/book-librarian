// タイトルから検索用のバリエーションを生成する純粋関数群。
// 外部書誌API（NDLサーチ等）は完全一致に近い形でしか引っかからないため、
// 宣伝文句的な括弧・巻数表記・長い副題を段階的に取り除いたバリエーションを用意し、
// 元タイトル→正規化後の順に試すことで検索のヒット率を上げる。
// 根拠: spike/s12_isbn_ndc_lookup.mjsでの実測（例:「銃・病原菌・鉄 下巻 一万三〇〇〇年に
// わたる人類史の謎」はNDLで0件ヒットだったが、「下巻」を除去すると4件ヒットする）。

const VOLUME_MARKER = /(?:上巻|下巻|中巻|前巻|後巻|前編|後編|完結編|合本版)/;

// 先頭の宣伝文句的な括弧（【】／［］／〈〉）を取り除く。
export function stripLeadingPromoBracket(title) {
  return title.replace(/^[【［\[〈][^】］\]〉]*[】］\]〉]\s*/, '').trim();
}

// 巻数表記（上巻／下巻／【上巻】等）を、位置（先頭・中間・末尾）を問わず取り除く。
export function stripVolumeMarkers(title) {
  return title
    .replace(new RegExp(`[【［\\[]${VOLUME_MARKER.source}[】］\\]]`, 'g'), '')
    .replace(new RegExp(VOLUME_MARKER.source, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 副題区切り（コロン・ダッシュ・波ダッシュ等）より前で短縮したタイトルを返す。
// 区切りが先頭に近すぎる場合（3文字以下）は短縮しない。
export function shortenAtSubtitleSeparator(title) {
  const separators = /[\uff1a:\u2014\u2015\u2500\uff0d\u3000\u301c\uff5e―─－！!]/;
  const idx = title.search(separators);
  if (idx > 3) {
    const shortened = title.slice(0, idx).trim();
    if (shortened) return shortened;
  }
  return null;
}

// 外部書誌APIへのタイトル検索で試す順に、正規化バリエーションを返す（元タイトルが必ず先頭）。
// 括弧除去→巻数除去→副題短縮の順に段階的に適用し、変化がある段階だけをバリエーションとして積み上げる
// （直線的なパイプライン。組み合わせ爆発を避けるため、各段階は直前の結果に対してのみ適用する）。
export function titleSearchVariants(title) {
  const variants = [title];
  let current = title;

  const bracketStripped = stripLeadingPromoBracket(current);
  if (bracketStripped !== current) {
    current = bracketStripped;
    variants.push(current);
  }

  const volumeStripped = stripVolumeMarkers(current);
  if (volumeStripped !== current) {
    current = volumeStripped;
    variants.push(current);
  }

  const shortened = shortenAtSubtitleSeparator(current);
  if (shortened && shortened !== current) {
    variants.push(shortened);
  }

  return variants;
}
