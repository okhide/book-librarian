// フェイクのexecFnを注入して検証する。実際のnotebooklmコマンドは呼ばない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotebookLmCli } from '../../src/bridge/notebooklm/cli.js';

function fakeExecOk(stdoutByArgs) {
  return async (bin, args) => {
    const key = args.join(' ');
    const stdout = stdoutByArgs[key];
    if (stdout === undefined) throw new Error(`予期しない呼び出し: ${key}`);
    return { stdout, stderr: '' };
  };
}

test('listNotebooks: --json付きで実行しstdoutをJSONとしてパースする', async () => {
  const execFn = fakeExecOk({
    'list --json': JSON.stringify({ notebooks: [{ id: 'nb1', title: '蔵書ライブラリ: テスト' }] }),
  });
  const cli = createNotebookLmCli(execFn);
  const result = await cli.listNotebooks();
  assert.deepEqual(result, { notebooks: [{ id: 'nb1', title: '蔵書ライブラリ: テスト' }] });
});

test('createNotebook: TITLEを引数に渡す', async () => {
  const execFn = fakeExecOk({
    'create 蔵書ライブラリ: テスト --json': JSON.stringify({ id: 'nb1' }),
  });
  const cli = createNotebookLmCli(execFn);
  const result = await cli.createNotebook('蔵書ライブラリ: テスト');
  assert.equal(result.id, 'nb1');
});

test('addSource: title/typeオプションが引数に反映される', async () => {
  const execFn = fakeExecOk({
    'source add https://drive.example/x -n nb1 --json --title 本のタイトル --type url':
      JSON.stringify({ source_id: 'src1' }),
  });
  const cli = createNotebookLmCli(execFn);
  const result = await cli.addSource('nb1', 'https://drive.example/x', {
    title: '本のタイトル',
    type: 'url',
  });
  assert.equal(result.source_id, 'src1');
});

test('addDriveSource: --mime-typeを指定し、--jsonの無い平文出力からsourceIdを抽出する', async () => {
  const execFn = fakeExecOk({
    'source add-drive FILE_ID_A 本のタイトル -n nb1 --mime-type pdf':
      'Added Drive source: src_abc123\nTitle: 本のタイトル.pdf',
  });
  const cli = createNotebookLmCli(execFn);
  const result = await cli.addDriveSource('nb1', 'FILE_ID_A', '本のタイトル', { mimeType: 'pdf' });
  assert.equal(result.ok, true);
  assert.equal(result.sourceId, 'src_abc123');
});

test('addDriveSource: 失敗時（無効なファイルID等）はok:falseを返す', async () => {
  const execFn = async () => {
    const err = new Error('Command failed');
    err.stdout = '';
    err.stderr = 'Error: Invalid source data: None';
    throw err;
  };
  const cli = createNotebookLmCli(execFn);
  const result = await cli.addDriveSource('nb1', 'not-a-real-id', 'タイトル');
  assert.equal(result.ok, false);
  assert.equal(result.sourceId, null);
});

test('ask: sourceIds複数指定が-sの繰り返しになる', async () => {
  const execFn = fakeExecOk({
    'ask 質問 -n nb1 --json -s src1 -s src2': JSON.stringify({ answer: '回答' }),
  });
  const cli = createNotebookLmCli(execFn);
  const result = await cli.ask('nb1', '質問', { sourceIds: ['src1', 'src2'] });
  assert.equal(result.answer, '回答');
});

test('generateQuiz: --waitと--jsonを常に付与する', async () => {
  const execFn = fakeExecOk({
    'generate quiz -n nb1 --json --wait --quantity standard --difficulty medium':
      JSON.stringify({ artifact_id: 'art1', status: 'completed' }),
  });
  const cli = createNotebookLmCli(execFn);
  const result = await cli.generateQuiz('nb1', { quantity: 'standard', difficulty: 'medium' });
  assert.equal(result.status, 'completed');
});

test('deleteNotebook: --jsonを付けず-yで確認をスキップし、成功文言をokとして判定する', async () => {
  const execFn = fakeExecOk({
    'delete -n nb1 -y': 'Deleted notebook: nb1',
  });
  const cli = createNotebookLmCli(execFn);
  const result = await cli.deleteNotebook('nb1');
  assert.equal(result.ok, true);
});

test('deleteNotebook: 失敗時（該当ノートブックなし等）はok:falseを返す', async () => {
  const execFn = async () => {
    const err = new Error('Command failed');
    err.stdout = '';
    err.stderr = "Error: No notebook found starting with 'x'.";
    throw err;
  };
  const cli = createNotebookLmCli(execFn);
  const result = await cli.deleteNotebook('x');
  assert.equal(result.ok, false);
});

test('runJson: 非0終了でもstdoutがJSONならエラーを投げず結果として返す（認証切れ等）', async () => {
  const execFn = async () => {
    const err = new Error('Command failed');
    err.stdout = JSON.stringify({ error: true, code: 'ERROR', message: 'Authentication expired or invalid.' });
    err.stderr = '';
    throw err;
  };
  const cli = createNotebookLmCli(execFn);
  const result = await cli.listNotebooks();
  assert.equal(result.error, true);
  assert.match(result.message, /Authentication expired/);
});

test('runJson: stdoutがJSONとして解釈できない失敗は例外を投げる', async () => {
  const execFn = async () => {
    const err = new Error('Command failed');
    err.stdout = '';
    err.stderr = 'command not found';
    throw err;
  };
  const cli = createNotebookLmCli(execFn);
  await assert.rejects(() => cli.listNotebooks(), /notebooklmコマンド失敗/);
});

test('runJson: 成功時にJSONとして解釈できない出力は例外を投げる', async () => {
  const execFn = async () => ({ stdout: 'not json', stderr: '' });
  const cli = createNotebookLmCli(execFn);
  await assert.rejects(() => cli.listNotebooks(), /解釈できません/);
});

test('downloadQuiz: --jsonを付けず生の出力をそのまま返す', async () => {
  const execFn = async (bin, args) => {
    assert.deepEqual(args, ['download', 'quiz', '-n', 'nb1', '--format', 'json']);
    return { stdout: '{"questions":[]}', stderr: '' };
  };
  const cli = createNotebookLmCli(execFn);
  const result = await cli.downloadQuiz('nb1', { format: 'json' });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, '{"questions":[]}');
});

test('downloadQuiz: 失敗時もok:falseで例外を投げずに返す', async () => {
  const execFn = async () => {
    const err = new Error('Command failed');
    err.stdout = '';
    err.stderr = 'Authentication expired or invalid.';
    throw err;
  };
  const cli = createNotebookLmCli(execFn);
  const result = await cli.downloadQuiz('nb1');
  assert.equal(result.ok, false);
  assert.match(result.stderr, /Authentication expired/);
});

// notebooklmは-nに空文字/未指定を渡すと「現在のコンテキストのノートブック」に
// フォールバックする。誤って無関係な既存ノートブックを操作する事故が実際に起きたため、
// notebookIdが空のときは(特にdeleteで)execFnを呼ぶ前に必ず拒否されることを検証する。
test('deleteNotebook: notebookIdが空文字なら実行前に拒否され、execFnは呼ばれない', async () => {
  let execCalled = false;
  const cli = createNotebookLmCli(async () => {
    execCalled = true;
    return { stdout: '', stderr: '' };
  });
  await assert.rejects(() => cli.deleteNotebook(''), /notebookIdが空です/);
  assert.equal(execCalled, false);
});

test('deleteNotebook: notebookIdが未指定(undefined)でも拒否される', async () => {
  const cli = createNotebookLmCli(async () => ({ stdout: '', stderr: '' }));
  await assert.rejects(() => cli.deleteNotebook(undefined), /notebookIdが空です/);
});

for (const method of ['listSources', 'ask', 'generateQuiz', 'downloadQuiz']) {
  test(`${method}: notebookIdが空文字なら実行前に拒否される`, async () => {
    let execCalled = false;
    const cli = createNotebookLmCli(async () => {
      execCalled = true;
      return { stdout: '{}', stderr: '' };
    });
    await assert.rejects(() => cli[method]('', 'dummy'));
    assert.equal(execCalled, false);
  });
}

test('addSource: notebookIdが空文字なら実行前に拒否される', async () => {
  let execCalled = false;
  const cli = createNotebookLmCli(async () => {
    execCalled = true;
    return { stdout: '{}', stderr: '' };
  });
  await assert.rejects(() => cli.addSource('', 'https://example.com'));
  assert.equal(execCalled, false);
});

test('addDriveSource: notebookIdが空文字なら実行前に拒否される', async () => {
  let execCalled = false;
  const cli = createNotebookLmCli(async () => {
    execCalled = true;
    return { stdout: '', stderr: '' };
  });
  await assert.rejects(() => cli.addDriveSource('', 'FILE_ID_A', 'タイトル'));
  assert.equal(execCalled, false);
});
