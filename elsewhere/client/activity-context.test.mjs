import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreActivityContext, contextAudit } from './activity-context.mjs';

const base = {
  plan: { settings: { connection_goal: '中国境内全程远程的 AI 产品实习' } },
  continuation: {
    items: [{ id: 'internship', known: '已问过远程条件', status: 'waiting' }],
  },
  now: 123,
};
void test('host cancellation stops retrieval instead of continuing as a retrieval failure', async () => {
  const controller = new AbortController();
  const cancelled = new Error('cancelled');
  await assert.rejects(
    restoreActivityContext({
      ...base,
      signal: controller.signal,
      provider: async () => {
        controller.abort();
        throw cancelled;
      },
    }),
    (error) => error === cancelled,
  );
});
void test('host retrieval receives the current purpose and matters, without silently treating unavailable memory as searched', async () => {
  assert.equal(
    (await restoreActivityContext(base)).retrieval.status,
    'unavailable',
  );
  const result = await restoreActivityContext({
    ...base,
    provider: async (request) => {
      assert.equal(request.intent, base.plan.settings.connection_goal);
      assert.equal(request.matters[0].known, '已问过远程条件');
      return { status: 'empty', facts: [] };
    },
  });
  assert.equal(result.retrieval.status, 'empty');
  assert.equal(
    (
      await restoreActivityContext({
        ...base,
        provider: async () => {
          throw new Error('private provider details');
        },
      })
    ).retrieval.status,
    'failed',
  );
});
void test('only deliberately public excerpts reach the public loop and the audit does not copy text', async () => {
  const context = await restoreActivityContext({
    ...base,
    provider: async () => ({
      status: 'retrieved',
      facts: [
        {
          id: 'new-goal',
          text: '用户已将方向从数据分析改为 AI 产品与科技战略，仍须全程远程。',
          source_ref: 'host:confirmed-correction',
          public: true,
          observed_at: '2026-10-16',
        },
        {
          id: 'private',
          text: '私密聊天内容',
          source_ref: 'host:private',
          public: false,
        },
      ],
    }),
  });
  assert.equal(context.facts.length, 1);
  assert.equal(context.retrieval.withheld, 1);
  assert.doesNotMatch(
    JSON.stringify(contextAudit(context, { contract: 'v1' })),
    /私密聊天|数据分析/,
  );
  assert.match(context.facts[0].text, /全程远程/);
});
void test('context cannot enter the public loop without provenance or with credentials', async () => {
  await assert.rejects(
    restoreActivityContext({
      ...base,
      provider: async () => ({
        status: 'retrieved',
        facts: [{ id: 'x', text: 'claim', public: true }],
      }),
    }),
    /source reference/,
  );
  await assert.rejects(
    restoreActivityContext({
      ...base,
      provider: async () => ({
        status: 'retrieved',
        facts: [
          {
            id: 'x',
            text: 'password=secretvalue',
            source_ref: 'host:x',
            public: true,
          },
        ],
      }),
    }),
    /Credentials/,
  );
});
void test('curated evidence stays evidence, truncation is disclosed and never converted into an inferred owner goal', async () => {
  const result = await restoreActivityContext({
    ...base,
    records: [
      {
        work_id: 'picture',
        result: '电影'.repeat(1000),
        shareable: true,
        status: 'context',
      },
    ],
  });
  assert.equal(result.facts[0].excerpt, true);
  assert.equal(result.facts[0].status, 'context');
  assert.equal(result.intent, undefined);
});
