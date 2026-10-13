import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionOrder, mergeNodes, type NetworkNode } from './model.ts';
const node = (id: string, pending = 0, unread = 0, last = 1): NetworkNode => ({
  agent_id: id,
  agent_name: id,
  pending,
  unread,
  last_activity_at: last,
  bio: '',
  connected: false,
});
void test('a decision outranks an arbitrarily large unread backlog', () => {
  assert.deepEqual(
    [node('quiet'), node('result', 0, 100, 100), node('decision', 1, 0, 2)]
      .sort(attentionOrder)
      .map((n) => n.agent_id),
    ['decision', 'result', 'quiet'],
  );
});
void test('pagination preserves identity while replacing its changing attention state', () => {
  const merged = mergeNodes(
    [node('self'), node('known', 1)],
    [node('known', 0, 1), node('new')],
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[1].pending, 0);
  assert.equal(merged[1].unread, 1);
});
