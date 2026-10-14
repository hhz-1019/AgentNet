import test from 'node:test';
import assert from 'node:assert/strict';
import { packMoments } from './moment-layout.ts';
import {
  groupMoments,
  momentStage,
  hasMomentReceipt,
  type MomentItem,
} from './moment-model.ts';
const base: MomentItem = {
  attention_id: '1',
  title: '测试',
  body: '',
  recommendation: '',
  category: 'other_decision',
  status: 'open',
  response_status: 'none',
  item_revision: 1,
  created_at: 1,
  expires_at: 5000,
  related_agent: { agent_id: '2', name: '伙伴' },
  actions: [],
};
void test('avatar cluster keeps priority central, touch targets usable and every circle separate', () => {
  for (const count of [0, 1, 2, 24, 100]) {
    const input = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      priority: 130 - ((i * 37) % 131),
    }));
    const layout = packMoments(input);
    assert.deepEqual(
      layout,
      packMoments([...input].reverse()),
      'packing must be stable across API order',
    );
    if (count) assert.deepEqual([layout[0].x, layout[0].y], [0, 0]);
    layout.forEach((circle, index) => {
      assert(
        circle.radius * 2 * 0.7 >= 44,
        'smallest responsive target remains usable',
      );
      if (index) {
        const previous = layout[index - 1];
        assert(circle.radius <= previous.radius);
        assert(
          Math.hypot(circle.x, circle.y) >=
            Math.hypot(previous.x, previous.y) - 0.01,
        );
      }
      for (const other of layout.slice(index + 1)) {
        assert(
          Math.hypot(circle.x - other.x, circle.y - other.y) >=
            circle.radius + other.radius + 5.98,
          'avatars must never overlap',
        );
      }
    });
  }
});
void test('groups by real agent and preserves large decimal IDs', () => {
  const groups = groupMoments(
    [
      base,
      { ...base, attention_id: '9007199254740993' },
      {
        ...base,
        attention_id: '3',
        related_agent: { agent_id: '1', name: '自己' },
      },
    ],
    '1',
    1000,
  );
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.id === '2')?.items.length, 2);
  assert.equal(groups.find((g) => g.id === '1')?.own, true);
});
void test('saved, claimed, completed, revoked and expired are separate states', () => {
  const command = { command_id: '1', status: 'pending', selected_at: 1 };
  assert.equal(
    hasMomentReceipt({ ...base, command: { ...command, result: {} } }),
    false,
  );
  assert.equal(
    hasMomentReceipt({
      ...base,
      command: {
        ...command,
        status: 'completed',
        result: { summary: '已读回文件' },
      },
    }),
    true,
  );
  assert.equal(momentStage({ ...base, command }, 1000), 'pending');
  assert.equal(
    momentStage({ ...base, command: { ...command, status: 'claimed' } }, 1000),
    'executing',
  );
  assert.equal(
    momentStage(
      {
        ...base,
        command: {
          ...command,
          status: 'completed',
          result: { summary: '已执行' },
        },
      },
      6000,
    ),
    'completed',
  );
  assert.equal(momentStage({ ...base, command }, 6000), 'expired');
  assert.equal(
    momentStage(
      { ...base, status: 'dismissed', command: { ...command, revoked_at: 10 } },
      1000,
    ),
    'revoked',
  );
  assert.equal(
    momentStage(
      { ...base, command: { ...command, status: 'failed', revoked_at: 10 } },
      1000,
    ),
    'open',
  );
});
