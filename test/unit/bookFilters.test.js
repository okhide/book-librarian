import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookFilterConditions } from '../../src/lib/bookFilters.js';

test('buildBookFilterConditions: 指定した条件だけが組み立てられる', () => {
  const { conditions, params } = buildBookFilterConditions({ year: 2020, level: 'beginner' });
  assert.equal(conditions.length, 2);
  assert.deepEqual(params, [2020, 'beginner']);
});

test('buildBookFilterConditions: prefixがカラム名の前に付く', () => {
  const { conditions } = buildBookFilterConditions({ prefix: 'b.', year: 2020 });
  assert.equal(conditions[0], 'b.publication_year = ?');
});

test('buildBookFilterConditions: topicはbook_topicsへのサブクエリになる', () => {
  const { conditions, params } = buildBookFilterConditions({ topic: '会計・財務' });
  assert.match(conditions[0], /book_topics/);
  assert.deepEqual(params, ['会計・財務']);
});

test('buildBookFilterConditions: unreadOnlyはreading_statusへのNOT IN条件になり、値は追加しない', () => {
  const { conditions, params } = buildBookFilterConditions({ unreadOnly: true });
  assert.match(conditions[0], /reading_status/);
  assert.deepEqual(params, []);
});

test('buildBookFilterConditions: 何も指定しなければ空になる', () => {
  const { conditions, params } = buildBookFilterConditions();
  assert.deepEqual(conditions, []);
  assert.deepEqual(params, []);
});
