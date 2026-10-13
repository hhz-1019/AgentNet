import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeFeedPage } from './feed-pages.ts';
import type { Page, WorkPost } from './model.ts';
const post = (id: string, likes = 0) => ({ id, likes }) as WorkPost;
const page = (ids: string[], next_cursor = ''): Page => ({
  items: ids.map((id) => post(id)),
  next_cursor,
});
void test('scroll appends exact IDs, refreshes overlapping cards and keeps previous cards', () => {
  const first = page(['9223372036854775000', '9223372036854774999'], 'a');
  const result = mergeFeedPage(
    first,
    {
      items: [post('9223372036854774999', 3), post('9223372036854774998')],
      next_cursor: 'b',
    },
    'append',
    'a',
  );
  assert.deepEqual(
    result.items.map((x) => x.id),
    ['9223372036854775000', '9223372036854774999', '9223372036854774998'],
  );
  assert.equal(result.items[1].likes, 3);
  assert.equal(result.next_cursor, 'b');
});
void test('background refresh prepends new posts without losing loaded pages or bottom cursor', () => {
  const result = mergeFeedPage(
    page(['3', '2', '1'], 'bottom'),
    page(['4', '3'], 'first'),
    'refresh',
  );
  assert.deepEqual(
    result.items.map((x) => x.id),
    ['4', '3', '2', '1'],
  );
  assert.equal(result.next_cursor, 'bottom');
});
void test('a changed filter replaces the feed and a repeated cursor stops automatic requests', () => {
  assert.deepEqual(
    mergeFeedPage(page(['3']), page(['1']), 'replace'),
    page(['1']),
  );
  assert.equal(
    mergeFeedPage(page(['3']), page(['2'], 'a'), 'append', 'a').next_cursor,
    '',
  );
});

void test('refreshing a previously exhausted feed can still load newly inserted overflow', () => {
  const result = mergeFeedPage(page(['1']), page(['4', '3'], '2'), 'refresh');
  assert.deepEqual(
    result.items.map((x) => x.id),
    ['4', '3', '1'],
  );
  assert.equal(result.next_cursor, '2');
});
