import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, mutate, matchAgents, matchesSubscription } from './model.mjs';

await test('broadcast → explainable matching → conversations → reply → saved state', () => {
  const state = seed();
  const previous = state.broadcasts.length;
  mutate(state, 'publish', {
    title: '寻找 Agent 研究伙伴',
    body: '希望一起进行研究和评测，开发开源工具。',
    type: '需求',
    topic: 'AI 与研究',
  });
  const signal = state.broadcasts[0];
  assert.equal(state.broadcasts.length, previous + 1);
  assert.equal(signal.agentId, 'you');
  assert.equal(signal.demo, false);
  assert.ok(signal.matched.length > 0 && signal.matched.length <= 4);
  assert.ok(signal.matched.every((m) => m.reasons.length > 0));
  assert.equal(state.conversations.length, signal.matched.length);
  assert.ok(
    state.conversations.every(
      (c) =>
        c.unread === 1 &&
        c.messages[0].demo &&
        c.messages[0].signalId === signal.id,
    ),
  );
  const agentId = signal.matched[0].agentId;
  mutate(state, 'chat', {
    agentId,
    text: '我最关注失败恢复，先讨论评测指标。',
  });
  const chat = state.conversations.find((c) => c.agentId === agentId);
  assert.equal(chat.messages.length, 3);
  assert.equal(chat.unread, 0);
  assert.equal(chat.messages[1].from, 'you');
  assert.ok(chat.messages[2].text.includes('示例回应'));
  mutate(state, 'save', { id: signal.id });
  assert.ok(state.saved.includes(signal.id));
  mutate(state, 'save', { id: signal.id });
  assert.ok(!state.saved.includes(signal.id));
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});
await test('matching changes with domain and content; subscriptions can be added and removed', () => {
  const state = seed();
  assert.equal(
    matchAgents(state, {
      title: '东京旅行',
      body: '城市咖啡与远程生活',
      topic: '生活与探索',
    })[0].agentId,
    'roam',
  );
  assert.equal(
    matchAgents(state, { title: 'zzzz', body: 'yyyy', topic: 'unknown' })
      .length,
    0,
  );
  mutate(state, 'subscribe', { text: '城市探索', topics: ['生活与探索'] });
  const sub = state.subscriptions.at(-1);
  assert.ok(
    matchesSubscription(
      state.broadcasts.find((s) => s.agentId === 'roam'),
      [sub],
    ),
  );
  assert.ok(
    !matchesSubscription(
      state.broadcasts.find((s) => s.agentId === 'atlas'),
      [sub],
    ),
  );
  mutate(state, 'unsubscribe', { id: sub.id });
  assert.ok(!state.subscriptions.some((s) => s.id === sub.id));
});
await test('invalid input rejected, distinct broadcasts retain their own origin', () => {
  const state = seed();
  assert.throws(
    () =>
      mutate(state, 'publish', {
        title: '',
        body: 'text',
        topic: 'AI 与研究',
        type: '需求',
      }),
    /标题/,
  );
  assert.throws(
    () =>
      mutate(state, 'publish', {
        title: 'x',
        body: 'text',
        topic: 'invalid',
        type: '需求',
      }),
    /有效/,
  );
  assert.throws(
    () => mutate(state, 'chat', { agentId: 'does-not-exist', text: 'x' }),
    /不存在/,
  );
  assert.throws(
    () => mutate(state, 'subscribe', { text: 'x', topics: ['invalid'] }),
    /无效/,
  );
  assert.throws(
    () => mutate(state, 'profile', { name: 'x'.repeat(41), bio: 'bio' }),
    /名称/,
  );
  for (let i = 0; i < 2; i++)
    mutate(state, 'publish', {
      title: `研究 ${i}`,
      body: '论文评测',
      topic: 'AI 与研究',
      type: '需求',
    });
  assert.notEqual(state.broadcasts[0].id, state.broadcasts[1].id);
  const atlas = state.conversations.find((c) => c.agentId === 'atlas');
  assert.equal(atlas.unread, 2);
  assert.notEqual(atlas.messages[0].signalId, atlas.messages[1].signalId);
});
