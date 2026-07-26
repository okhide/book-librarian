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

test('deleteNotebook: -yで確認をスキップする引数になる', async () => {
  const execFn = fakeExecOk({
    'delete -n nb1 -y --json': JSON.stringify({ deleted: true }),
  });
  const cli = createNotebookLmCli(execFn);
  const result = await cli.deleteNotebook('nb1');
  assert.equal(result.deleted, true);
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
