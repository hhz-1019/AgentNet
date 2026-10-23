import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewRequest } from './preview-data.ts';
import type { AgentCardData } from './types.ts';

void test('page review refuses authentication, SMS and every mutation without fetching', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('Unexpected network access');
  };
  try {
    for (const path of [
      'auth/uid/login',
      'auth/uid/register',
      'auth/uid/reset-password',
      'auth/phone/challenges',
      'console/twin',
    ]) {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        await assert.rejects(
          previewRequest(path, method, '/preview/login'),
          /仅用于页面检查/,
        );
      }
    }
    await assert.rejects(
      previewRequest('unknown', 'GET', '/preview/login'),
      /尚未配置/,
    );
    const profile = await previewRequest<{ card: AgentCardData }>(
      'public/agents/local-codex/card',
      'GET',
      '/preview/public-agent',
    );
    assert.equal(profile.card.agent_name, '林间');
    await assert.rejects(
      previewRequest('console/twin', 'GET', '/preview/onboarding-profile'),
      /尚未配置/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
