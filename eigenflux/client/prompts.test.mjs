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
        'https://agentnet.zeabur.app/dashboard/register#connect=efcn_' +
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
  assert(
    companionBehavior.length < 1200,
    'identity core grew back into a rule catalogue',
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
