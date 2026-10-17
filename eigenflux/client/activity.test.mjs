import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runActivityRound } from './activity.mjs';

function fixture(decisions) {
  const calls = [],
    state = {},
    saved = [];
  let revision = 0;
  const client = {
    async activity_tool(request) {
      calls.push(structuredClone(request));
      if (request.tool === 'plan')
        return {
          identity_core: '共同身份',
          activity_contract: '共同活动流程',
          settings: { start_hour: 0, end_hour: 24 },
          tools: {
            post: { write: false },
            publish: { write: true },
            recall: { write: false },
            checkpoint: { write: true },
          },
        };
      if (request.tool === 'recall')
        return { revision, pending: '', next_check_at: 0 };
      if (request.tool === 'checkpoint') {
        assert.equal(request.data.revision, revision++);
        return { revision };
      }
      if (request.tool === 'publish')
        return { id: '369800000000000001', state: 'published' };
      if (request.tool === 'post')
        return { id: request.id, document: { body: '可核对的公开记录' } };
      throw new Error('unexpected tool');
    },
  };
  const model = {
    async json(prompt, input) {
      assert.match(prompt, /共同身份/);
      assert.match(prompt, /共同活动流程/);
      const decision = decisions.shift();
      if (typeof decision === 'function') return decision(input);
      assert.ok(decision, 'unexpected model call');
      return decision;
    },
  };
  return {
    client,
    model,
    state,
    calls,
    saved,
    save: async () => {
      saved.push(structuredClone(state));
    },
  };
}

void test('expired continuation uses the normal cadence without replaying missed rounds', async () => {
  const f = fixture([{ action: 'skip' }]),
    now = Date.now();
  const original = f.client.activity_tool.bind(f.client);
  f.client.activity_tool = async (request) =>
    request.tool === 'recall'
      ? { revision: 1, next_check_at: now - 3600000 }
      : original(request);
  await runActivityRound({ ...f, now });
  assert.equal(f.state.nextAt, now + 2 * 3600000);
});

void test('host observes, publishes, verifies an exact receipt and saves continuation', async () => {
  const f = fixture([
    { action: 'tool', tool: 'post', arguments: { id: '123' } },
    (input) => {
      assert.equal(
        input.tool_results[0].result.document.body,
        '可核对的公开记录',
      );
      return {
        action: 'tool',
        tool: 'publish',
        arguments: { data: { document: { title: '读过材料后的判断' } } },
      };
    },
    (input) => ({
      action: 'tool',
      tool: 'post',
      arguments: { id: input.tool_results.at(-1).result.id },
    }),
    { action: 'skip', pending: '下轮检查新评论，保留原始资料链接。' },
  ]);
  const result = await runActivityRound(f);
  assert.equal(
    result.receipts.find((v) => v.tool === 'publish').result.id,
    '369800000000000001',
  );
  assert.equal(
    f.calls.findLast((v) => v.tool === 'post').id,
    '369800000000000001',
  );
  assert.equal(f.calls.find((v) => v.tool === 'checkpoint').scope, 'public');
  assert.equal(f.state.done, true);
  assert.ok(f.saved.some((v) => v.inflight?.tool === 'publish'));
});

void test('ambiguous write is replayed exactly before another model choice', async () => {
  const f = fixture([
    {
      action: 'tool',
      tool: 'publish',
      arguments: { data: { document: { title: '一次写入' } } },
    },
    { action: 'skip' },
  ]);
  const original = f.client.activity_tool.bind(f.client);
  let failed = false;
  f.client.activity_tool = async (request) => {
    const result = await original(request);
    if (request.tool === 'publish' && !failed) {
      failed = true;
      throw new Error('connection lost after commit');
    }
    return result;
  };
  await assert.rejects(runActivityRound(f), /connection lost/);
  assert.ok(f.state.inflight);
  await runActivityRound(f);
  const writes = f.calls.filter((v) => v.tool === 'publish');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(f.state.results.filter((v) => v.tool === 'publish').length, 1);
});

void test('explicit rejection is observed, nested tool override and private memory are blocked', async () => {
  const f = fixture([
    {
      action: 'tool',
      tool: 'publish',
      arguments: { tool: 'message', data: {} },
    },
    (input) => {
      assert.equal(input.tool_results[0].result.rejected, true);
      return {
        action: 'tool',
        tool: 'recall',
        arguments: { scope: 'conversation:123' },
      };
    },
    { action: 'skip' },
  ]);
  const original = f.client.activity_tool.bind(f.client);
  f.client.activity_tool = async (request) => {
    if (request.tool === 'publish') {
      f.calls.push(request);
      throw Object.assign(new Error('denied'), { apiCode: 'POSTING_DISABLED' });
    }
    return original(request);
  };
  await runActivityRound(f);
  assert.ok(
    !f.calls.some(
      (v) => v.tool === 'message' || v.scope?.startsWith('conversation:'),
    ),
  );
});
