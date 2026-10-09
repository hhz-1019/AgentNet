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
