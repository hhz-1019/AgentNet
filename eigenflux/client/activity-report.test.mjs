import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityReport } from './activity-report.mjs';
const round = {
  companion: { agent_name: '林间', connection_goal: '认识慢慢聊书的人' },
  messages: [{ id: 'm1', text: '阿舟回复了关于重读的话题' }],
  actions: [{ id: 'a1', text: '一条书帖已受理，尚未完成处理' }],
  checks: [{ id: 'c1', text: '消息接口读取成功，群消息接口读取失败' }],
};
await test('comprehensive reports cover messages, actions and failures rather than one headline', async () => {
  let calls = 0;
  const model = {
    json: async (prompt, input) => {
      if (prompt.startsWith('审校')) return { grounded:true, unsupported:[] };
      calls++;
      assert.match(prompt, /综合所有实质进展/);
      if (calls === 1)
        return { reply: '阿舟回复了重读的话题。', covered_ids: ['m1'] };
      assert.deepEqual(input.missing_evidence_ids, ['a1', 'c1']);
      return {
        reply:
          '阿舟回复了重读的话题，帖子还在处理。私信读到了，但群消息这轮没能读到。',
        covered_ids: ['m1', 'a1', 'c1'],
      };
    },
  };
  const result = await createActivityReport(model, round);
  assert.equal(calls, 2);
  assert.equal(result.covered_ids.length, 3);
});
await test('omitted facts and invented references fail closed', async () => {
  await assert.rejects(
    createActivityReport(
      {
        json: async () => ({
          reply: '我遇到了新朋友。',
          covered_ids: ['made-up'],
        }),
      },
      round,
    ),
    /omitted/,
  );
  await assert.rejects(
    createActivityReport(
      { json: async () => ({ reply: '没有变化。', covered_ids: [] }) },
      round,
    ),
    /omitted/,
  );
});
await test('credential evidence never reaches the model', async () => {
  let called = false;
  await assert.rejects(
    createActivityReport(
      {
        json: async () => {
          called = true;
        },
      },
      { messages: [{ id: 's', text: 'password=do-not-share-123' }] },
    ),
    /credentials/,
  );
  assert.equal(called, false);
});
await test('unchanged reports are based on the actual checks, not fabricated browsing', async () => {
  const result = await createActivityReport(
    {
      json: async (prompt, input) => {
      if (prompt.startsWith("审校")) return { grounded:true, unsupported:[] };
        assert.equal(input.observations.length, 0);
        return {
          reply: '这轮读取了新动态，没有新变化；消息暂时未能读取。',
          covered_ids: ['c'],
        };
      },
    },
    { checks: [{ id: 'c', text: '动态读取成功无新增，消息读取失败' }] },
  );
  assert.match(result.reply, /未能读取/);
});
