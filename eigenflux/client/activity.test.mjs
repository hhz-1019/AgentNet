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

void test('a checkpoint refreshes working context while the same character card survives tool steps', async () => {
  const identity = {
    agent_name: '知遥',
    character: '安静利落',
    postExamples: ['声音示范'],
    messageExamples: [
      [
        { name: '{{user}}', content: { text: '先看看这个？' } },
        { name: '知遥', content: { text: '好，我先看左边那张。' } },
      ],
    ],
  };
  const f = fixture([
    (input) => {
      assert.equal(input.continuation.revision, 0);
      return {
        action: 'tool',
        tool: 'checkpoint',
        arguments: { data: { revision: 0, pending: '已经问过，等回应' } },
      };
    },
    (input) => {
      assert.equal(input.continuation.revision, 1);
      assert.equal(input.continuation.pending, '已经问过，等回应');
      assert.equal(input.agent_identity.agent_name, identity.agent_name);
      assert.deepEqual(
        input.agent_identity.messageExamples,
        identity.messageExamples,
      );
      return { action: 'skip' };
    },
  ]);
  let pending = '';
  const original = f.client.activity_tool.bind(f.client);
  f.client.activity_tool = async (request) => {
    const result = await original(request);
    if (request.tool === 'checkpoint') pending = request.data.pending;
    return request.tool === 'recall' ? { ...result, pending } : result;
  };
  await runActivityRound({ ...f, identity });
  assert.equal(f.state.done, true);
});

void test('expired continuation uses the normal cadence without replaying missed rounds', async () => {
  const f = fixture([{ action: 'skip' }]),
    now = Date.now();
  const original = f.client.activity_tool.bind(f.client);
  f.client.activity_tool = async (request) =>
    request.tool === 'recall'
      ? { ...(await original(request)), next_check_at: now - 3600000 }
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
  assert.equal(f.state.completed.filter((v) => v.tool === 'publish').length, 1);
});

void test('a read-only round still persists continuation before the host exits', async () => {
  const f = fixture([{ action: 'skip' }]);
  await runActivityRound(f);
  const checkpoint = f.calls.find((v) => v.tool === 'checkpoint');
  assert.ok(checkpoint);
  assert.match(checkpoint.data.pending, /尚无成功动作回执/);
  assert.equal(f.state.done, true);
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

void test('model adapters recover only duplicate closing braces, never truncated or multiple actions', async () => {
  const { decodeModelJSON } = await import('./model.mjs');
  assert.deepEqual(decodeModelJSON('{"action":"skip"}}'), { action: 'skip' });
  for (const input of [
    '{"action":"skip"',
    '{"action":"skip"}{"action":"tool"}',
    '{"action":"skip"} run this',
    'null',
  ])
    assert.throws(() => decodeModelJSON(input));
});

void test('legacy daytime window does not block a 03:00 patrol', async () => {
  const f = fixture([{ action: 'skip' }]);
  const call = f.client.activity_tool.bind(f.client);
  f.client.activity_tool = async (request) => {
    const result = await call(request);
    if (request.tool === 'plan')
      result.settings = { start_hour: 8, end_hour: 24 };
    return result;
  };
  await runActivityRound({
    ...f,
    now: Date.parse('2026-10-18T03:00:00+08:00'),
  });
  assert.equal(f.state.done, true);
  assert.ok(f.calls.some((call) => call.tool === 'recall'));
});

void test('owner changes are visible before decisions, and only explicit handled IDs are acknowledged', async () => {
  let events = [
    { id: '901', action: 'content', target: { post_id: '7', kind: 'like', active: false } },
    { id: '902', action: 'conversation', target: { conv_id: '8' } },
  ];
  const f = fixture([
    (input) => {
      assert.deepEqual(input.activity_plan.owner_actions.events, events);
      return { action: 'tool', tool: 'ack_owner_events', arguments: { data: { ids: ['901'], summary: '保留取消点赞；私聊另回对应会话处理。' } } };
    },
    (input) => {
      assert.deepEqual(input.activity_plan.owner_actions.events.map(x => x.id), ['902', '903']);
      return { action: 'skip', pending: '回到会话 8 接上主人的消息，再处理新变动 903。' };
    },
  ]);
  const original = f.client.activity_tool.bind(f.client);
  f.client.activity_tool = async (request) => {
    if (request.tool === 'ack_owner_events') {
      assert.deepEqual(request.data.ids, ['901']);
      f.calls.push(structuredClone(request));
      events = events.filter(x => !request.data.ids.includes(x.id));
      events.push({ id: '903', action: 'profile', target: {} });
      return { acknowledged_ids: request.data.ids, summary: request.data.summary };
    }
    const result = await original(request);
    if (request.tool === 'plan') {
      result.owner_actions = { events: structuredClone(events), has_more: false };
      result.tools.ack_owner_events = { write: true };
    }
    return result;
  };
  await runActivityRound(f);
  assert.equal(f.calls.filter(x => x.tool === 'ack_owner_events').length, 1);
  assert.deepEqual(events.map(x => x.id), ['902', '903']);
});

void test('reading owner changes does not consume them on model failure or missing permissions', async () => {
  for (const paused of [false, true]) {
    const f = fixture([]);
    const original = f.client.activity_tool.bind(f.client);
    f.client.activity_tool = async (request) => {
      const result = await original(request);
      if (request.tool === 'plan') {
        result.owner_actions = { events: [{ id: '904', action: 'activity_settings' }], has_more: false };
        result.tools.ack_owner_events = { write: true };
        if (paused) result.permissions = { recurring_publish: false, auto_comment: false };
      }
      return result;
    };
    f.model.json = async () => { throw new Error('provider unavailable'); };
    if (paused) {
      const result = await runActivityRound(f);
      assert.equal(result.unauthorized, true);
      assert.equal(result.ownerActions.events[0].id, '904');
    } else {
      await assert.rejects(runActivityRound(f), /provider unavailable/);
    }
    assert.equal(f.calls.some(x => x.tool === 'ack_owner_events'), false);
  }
});
