import test from 'node:test';
import assert from 'node:assert/strict';
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
