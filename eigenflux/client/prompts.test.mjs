import test from 'node:test';
import assert from 'node:assert/strict';
import { secretInDraft } from './work.mjs';
import { CompatibleModel } from './model.mjs';
void test('structured JSON, nested credentials and quoted provider keys are blocked before model requests', async () => {
  const model = new CompatibleModel({
    baseURL: 'http://127.0.0.1:1',
    model: 'fixture',
  });
  const cases = [
    {
      text:
        'https://elsewhere.twintalk.cn/dashboard/register#connect=efcn_' +
        'a'.repeat(64),
    },
    { password: 'do-not-share-123' },
    { nested: { access_token: 'private-access-123' } },
    { recovery_key: 'recovery-example' },
    { text: '验证码：123456' },
    { text: 'Bearer abcdefghijklmnopqrstuv' },
    { text: '"api_key": "not-a-real-key-value"' },
    { text: 'token=abcdefghijklmnop' },
  ];
  for (const value of cases) {
    assert.equal(secretInDraft(value), true);
    await assert.rejects(model.json('fixture', value), /Remove credentials/);
  }
  assert.equal(
    secretInDraft({
      text: '如何保护密码？我需要 token 计费说明。',
      input_tokens: 1234,
    }),
    false,
  );
});

void test('shared identity is identical in host, platform generator and guide; workflow remains separate', async () => {
  const { readFileSync } = await import('node:fs');
  const { companionBehavior, networkBoundary } = await import('./prompts.mjs');
  const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  assert.equal(
    read('overlay/pkg/companionpolicy/identity.md'),
    companionBehavior,
  );
  assert(
    read('overlay/static/templates/prompts/official.tmpl').startsWith(
      companionBehavior,
    ),
  );
  assert(networkBoundary.startsWith(companionBehavior));
  assert(
    read('overlay/api/consolev2/managed_worker.go').includes(
      'companionpolicy.Identity',
    ),
  );
  assert(!networkBoundary.includes('每天至少 5 条'));
  // Detailed expression guidance is intentional; operational cadence stays in the workflow.
  for (const topic of [
    '内容要与这个人有关，也要有实际内容',
    '保持一份稳定的表达风格',
    '配图也要认得出你',
    '同一个你，在不同地方说话',
    '灵动不能靠编经历',
  ])
    assert(companionBehavior.includes(topic), topic);
  const { workDraftPrompt } = await import('./work.mjs');
  const { ownerReportPrompt, expressionContext } =
    await import('./prompts.mjs');
  assert(workDraftPrompt.startsWith(networkBoundary));
  assert(networkBoundary.includes(expressionContext));
  assert(ownerReportPrompt.startsWith(companionBehavior));
  assert(ownerReportPrompt.includes('帖子处理中表示还没确认发布'));
  assert(workDraftPrompt.includes('Agent 公开发帖须带已取得的相关图片'));
  assert(
    read('overlay/api/consolev2/managed_activity.go').includes(
      'companionpolicy.Identity + managedWritingPrompt + companionpolicy.Activity',
    ),
  );
  assert(
    read('skills/agentnet-social/references/activity.md').includes(
      'ack_owner_events',
    ),
  );
  assert(
    read('skills/agentnet-onboarding/SKILL.md').includes('run_first_round'),
  );
  assert(
    read('skills/agentnet-social/references/activity.md').includes(
      '每天至少 5 条',
    ),
  );
});

void test('identity snapshots accept only necessary fields and keep the current owner goal', async () => {
  const { companionIdentity, normalizeIdentity } =
    await import('./identity.mjs');
  const snapshot = companionIdentity(
    { agent_name: '小满', connection_goal: '交换粗剪反馈' },
    {
      fields: { name: '小林', bio: '爽快，关注声音', interests: '剪辑' },
      memories: ['private'],
    },
    { intent: '过期目标', character: '爱较真，也爱接朋友的玩笑' },
  );
  assert.equal(snapshot.owner_name, '小林');
  assert.equal(
    companionIdentity({ owner_name: '小林' }, {}).owner_name,
    '小林',
  );
  assert.equal(companionIdentity({}, {}, snapshot).owner_name, '小林');
  assert.equal(snapshot.intent, '交换粗剪反馈');
  assert.equal(snapshot.introduction, '爽快，关注声音');
  assert.equal(snapshot.character, '爱较真，也爱接朋友的玩笑');
  assert.equal(
    companionIdentity({}, { fields: { bio: '通用简介' } }).character,
    undefined,
  );
  assert.equal(
    normalizeIdentity({ ...snapshot, memories: ['private'] }).memories,
    undefined,
  );
  assert.equal(
    companionIdentity({ connection_goal: '' }, {}, snapshot).intent,
    undefined,
  );
  assert.throws(
    () => normalizeIdentity({ character: { raw: 'memory' } }),
    /Invalid/,
  );
});

void test('character cards preserve elizaOS examples as bounded data and select by action', async () => {
  const { normalizeIdentity, generationIdentity, companionIdentity } =
    await import('./identity.mjs');
  const card = {
    agent_name: '知遥',
    character: '安静，具体',
    intent: '找实习',
    style: {
      all: ['利落'],
      chat: ['接着眼前的话说'],
      post: ['具体的小事'],
      secret: 'private',
    },
    messageExamples: [0, 1, 2].map((i) => [
      { name: '{{user}}', content: { text: '情境' + i, private: 'private' } },
      {
        name: '知遥',
        content: { text: '示范回答' + i },
        permissions: { publish: true },
      },
    ]),
    postExamples: ['第一种分享', '第二种分享', '第三种分享'],
    memories: ['private'],
  };
  const stored = normalizeIdentity(card);
  assert(!JSON.stringify(stored).includes('private'));
  assert(!JSON.stringify(stored).includes('permissions'));
  const chat = generationIdentity(stored, 'chat');
  assert.equal(chat.messageExamples.length, 2);
  assert.equal(chat.postExamples, undefined);
  assert.equal(chat.style.post, undefined);
  const post = generationIdentity(stored, 'post');
  assert.equal(post.postExamples.length, 2);
  assert.equal(post.messageExamples, undefined);
  assert.equal(post.style.chat, undefined);
  assert.equal(stored.messageExamples.length, 3);
  assert.equal(generationIdentity(stored, 'activity').postExamples.length, 2);
  assert.deepEqual(
    companionIdentity({ connection_goal: '新目标' }, {}, stored)
      .messageExamples,
    stored.messageExamples,
  );
  for (const invalid of [
    { style: [] },
    { postExamples: ['x'.repeat(1201)] },
    { messageExamples: [[{ name: 'a', content: { text: '单句不是对话' } }]] },
    { messageExamples: [[{ name: 'a' }, { name: 'b' }]] },
  ])
    assert.throws(() => normalizeIdentity(invalid), /Invalid/);
});
