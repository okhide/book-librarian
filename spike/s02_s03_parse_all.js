// spike S2/S3: [ ] を含むファイル名の読み込み検証、および全2,527件のパース可否を集計する。
// fs.readdirSync はリテラルなファイル名一覧を返す（globパターン解釈をしない）ため、
// これを使えば PowerShell の Get-ChildItem -Filter で起きた [ ] 問題を回避できるはずである。
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('data/output_data');

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md'));
console.log(`readdirSync で列挙できたファイル数: ${files.length}`);

const bracketFiles = files.filter((f) => f.includes('[') || f.includes(']'));
console.log(`[ ] を含むファイル名: ${bracketFiles.length}件`);

let readOk = 0;
let readFail = [];
let hasFrontmatter = 0;
let hasSection1 = 0;
let hasSection2 = 0;
let missingBoth = [];
let missingSection1Only = [];
let missingSection2Only = [];
let headingVariants = new Set();

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
// 見出しの表記ゆれを検知するため、まず "# " から始まる行を全部集める
const HEADING_RE = /^#\s+.+$/gm;

for (const file of files) {
  const fullPath = path.join(DIR, file);
  let text;
  try {
    text = fs.readFileSync(fullPath, 'utf8');
    readOk++;
  } catch (e) {
    readFail.push({ file, error: e.message });
    continue;
  }

  if (FRONTMATTER_RE.test(text)) hasFrontmatter++;

  const s1 = /(?:^|\n)#\s*1\.\s*画面右側から取得した初期要約\s*\n([\s\S]*?)(?=\n#\s*2\.)/.exec(text);
  const s2 = /(?:^|\n)#\s*2\.\s*プロンプト回答（詳細要約）\s*\n([\s\S]*?)(?=\n```json)/.exec(text);

  if (s1) hasSection1++;
  if (s2) hasSection2++;
  if (!s1 && !s2) missingBoth.push(file);
  else if (!s1) missingSection1Only.push(file);
  else if (!s2) missingSection2Only.push(file);

  for (const m of text.matchAll(HEADING_RE)) {
    headingVariants.add(m[0].trim());
  }
}

console.log(`\n読み込み成功: ${readOk} / 失敗: ${readFail.length}`);
if (readFail.length) console.log('読み込み失敗ファイル:', readFail);

console.log(`\nフロントマターあり: ${hasFrontmatter}`);
console.log(`セクション1(初期要約)抽出: ${hasSection1}`);
console.log(`セクション2(詳細要約)抽出: ${hasSection2}`);
console.log(`両方欠落: ${missingBoth.length}件`);
console.log(`セクション1のみ欠落: ${missingSection1Only.length}件`);
console.log(`セクション2のみ欠落: ${missingSection2Only.length}件`);

if (missingBoth.length) console.log('\n両方欠落の例(先頭5件):', missingBoth.slice(0, 5));
if (missingSection1Only.length) console.log('\nセクション1欠落の例(先頭5件):', missingSection1Only.slice(0, 5));
if (missingSection2Only.length) console.log('\nセクション2欠落の例(先頭5件):', missingSection2Only.slice(0, 5));

// bracketFilesがちゃんと読めて両セクション取れているか個別確認
const bracketFailures = bracketFiles.filter(
  (f) => missingBoth.includes(f) || missingSection1Only.includes(f) || missingSection2Only.includes(f)
);
console.log(`\n[ ] を含むファイルのうちセクション抽出に失敗した数: ${bracketFailures.length} / ${bracketFiles.length}`);

console.log(`\n見出し(# で始まる行)のユニーク数: ${headingVariants.size}`);
console.log([...headingVariants].sort());
