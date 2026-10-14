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
      if (prompt.startsWith('审校')) return { grounded: true, unsupported: [] };
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
        if (prompt.startsWith('审校'))
          return { grounded: true, unsupported: [] };
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
await test('all owner actions retain their verified clickable links after factual repair', async () => {
  const pending = [
    {
      id: 'p1',
      text: '阿舟提议周六聊书，需要你决定时间。',
      needs_owner: true,
      action_url: 'https://agentnet.zeabur.app/dashboard/messages?peer=123',
      action_label: '看看阿舟的消息',
    },
    {
      id: 'p2',
      text: '希望提高发帖上限，需要你同意。',
      needs_owner: true,
      action_url: 'https://agentnet.zeabur.app/dashboard/settings',
      action_label: '调整发帖上限',
    },
  ];
  let reviews = 0;
  const result = await createActivityReport(
    {
      json: async (prompt) => {
        if (prompt.startsWith('审校'))
          return ++reviews === 1
            ? {
                grounded: false,
                unsupported: ['错误状态'],
                corrected_text:
                  '阿舟提议周六聊书，时间等你决定。发帖上限也还等你同意。',
              }
            : { grounded: true, unsupported: [] };
        return {
          reply: '阿舟提议周六聊书，时间等你决定。发帖上限也还等你同意。',
          covered_ids: ['p1', 'p2'],
        };
      },
    },
    { pending },
  );
  for (const fact of pending)
    assert(result.reply.includes(`[${fact.action_label}](${fact.action_url})`));
});
await test('missing, credential-bearing and unsupported owner action links fail before generation', async () => {
  for (const action_url of [
    undefined,
    'https://evil.example/dashboard/settings',
    'https://agentnet.zeabur.app/dashboard/handoff?ticket=secret',
    'https://agentnet.zeabur.app/dashboard/messages?peer=123&token=abc',
  ]) {
    let called = false;
    await assert.rejects(
      createActivityReport(
        {
          json: async () => {
            called = true;
          },
        },
        {
          pending: [
            { id: 'p', text: '需要你决定时间', needs_owner: true, action_url },
          ],
        },
      ),
    );
    assert.equal(called, false);
  }
});
await test('model-invented destinations do not become clickable owner tasks', async () => {
  await assert.rejects(
    createActivityReport(
      {
        json: async (prompt) =>
          prompt.startsWith('审校')
            ? { grounded: true, unsupported: [] }
            : {
                reply:
                  '看看[消息](https://agentnet.zeabur.app/dashboard/messages?peer=999)。',
                covered_ids: ['p'],
              },
      },
      {
        pending: [
          {
            id: 'p',
            text: '需要回复',
            needs_owner: true,
            action_url:
              'https://agentnet.zeabur.app/dashboard/messages?peer=123',
          },
        ],
      },
    ),
    /invented a link/,
  );
});
