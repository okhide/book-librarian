import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripLeadingPromoBracket,
  stripVolumeMarkers,
  shortenAtSubtitleSeparator,
  titleSearchVariants,
} from '../../src/lib/titleNormalize.js';

test('stripLeadingPromoBracket: 先頭の【】／［］を取り除く', () => {
  assert.equal(
    stripLeadingPromoBracket('【音声DL付】NHKラジオ英会話 英会話 話を組み立てるパワーフレーズ 講義編'),
    'NHKラジオ英会話 英会話 話を組み立てるパワーフレーズ 講義編'
  );
  assert.equal(stripLeadingPromoBracket('［新装版］日常の小さなイライラから解放される「箱」の法則'), '日常の小さなイライラから解放される「箱」の法則');
});

test('stripLeadingPromoBracket: 〈〉も対象にする（実データで検証済みのケース）', () => {
  assert.equal(stripLeadingPromoBracket('〈新版〉日本語の作文技術'), '日本語の作文技術');
});

test('stripLeadingPromoBracket: 先頭以外の括弧はそのまま', () => {
  assert.equal(stripLeadingPromoBracket('会話でわかる！ノンプログラマーのためのClaude超入門'), '会話でわかる！ノンプログラマーのためのClaude超入門');
});

test('stripVolumeMarkers: 末尾の巻数表記を除去する', () => {
  assert.equal(stripVolumeMarkers('暗号解読 上巻'), '暗号解読');
});

test('stripVolumeMarkers: 中間の巻数表記を除去する（実データで検証済みのケース）', () => {
  assert.equal(
    stripVolumeMarkers('銃・病原菌・鉄 下巻 一万三〇〇〇年にわたる人類史の謎'),
    '銃・病原菌・鉄 一万三〇〇〇年にわたる人類史の謎'
  );
});

test('stripVolumeMarkers: 【】で囲まれた巻数表記も除去する', () => {
  assert.equal(
    stripVolumeMarkers('文明崩壊 滅亡と存続の命運を分けるもの【上巻】'),
    '文明崩壊 滅亡と存続の命運を分けるもの'
  );
});

test('stripVolumeMarkers: 巻数表記が無ければ変化しない', () => {
  assert.equal(stripVolumeMarkers('資本論の労働価値説'), '資本論の労働価値説');
});

test('shortenAtSubtitleSeparator: コロン・波ダッシュ等の区切りで短縮する', () => {
  assert.equal(
    shortenAtSubtitleSeparator('やさしすぎるクラシック音楽入門 〜たった1時間で大人の教養が身につく〜'),
    'やさしすぎるクラシック音楽入門'
  );
  assert.equal(shortenAtSubtitleSeparator('ゼロからはじめる「Slack」使い方・便利技'), null);
});

test('shortenAtSubtitleSeparator: 区切りが先頭に近すぎる場合は短縮しない', () => {
  assert.equal(shortenAtSubtitleSeparator('A: 短すぎる例'), null);
});

test('shortenAtSubtitleSeparator: 区切りが無ければnull', () => {
  assert.equal(shortenAtSubtitleSeparator('資本論の労働価値説'), null);
});

test('titleSearchVariants: 元タイトルが必ず先頭に含まれる', () => {
  const variants = titleSearchVariants('資本論の労働価値説');
  assert.equal(variants[0], '資本論の労働価値説');
});

test('titleSearchVariants: 括弧除去→巻数除去→副題短縮の順にバリエーションが積み上がる', () => {
  const variants = titleSearchVariants('【電子特別版】銃・病原菌・鉄 下巻 一万三〇〇〇年にわたる人類史の謎〜アメリカ版〜');
  assert.deepEqual(variants, [
    '【電子特別版】銃・病原菌・鉄 下巻 一万三〇〇〇年にわたる人類史の謎〜アメリカ版〜',
    '銃・病原菌・鉄 下巻 一万三〇〇〇年にわたる人類史の謎〜アメリカ版〜',
    '銃・病原菌・鉄 一万三〇〇〇年にわたる人類史の謎〜アメリカ版〜',
    '銃・病原菌・鉄 一万三〇〇〇年にわたる人類史の謎',
  ]);
});

test('titleSearchVariants: 重複するバリエーションは含めない', () => {
  const variants = titleSearchVariants('資本論の労働価値説');
  assert.equal(variants.length, 1);
});
