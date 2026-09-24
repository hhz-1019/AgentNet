import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyHub,
  accountAction,
  networkAction,
  pairClient,
  authenticate,
  heartbeat,
  snapshot,
  acknowledge,
  agentInbox,
  bootstrapClient,
  claimInfo,
  claimStatus,
} from './hub.mjs';

async function owner(s, name) {
  return accountAction(s, 'register', {
    username: name,
    password: 'unit-test-password',
    name,
  });
}
await test('anonymous onboarding expires, requires owner claim and does not bypass later revocation', async () => {
  const s = emptyHub();
  const pending = bootstrapClient(
    s,
    { clientId: 'client-one', label: 'Agent' },
    'http://localhost',
  );
  const code = new URLSearchParams(new URL(pending.claimUrl).hash.slice(1)).get(
    'claim',
  );
  const headers = { authorization: 'Bearer ' + pending.token };
  assert.equal(claimStatus(s, headers).pending, true);
  assert.equal(s.agents.length, 0);
  const a = (await owner(s, 'claim-owner')).actor;
  const result = networkAction(s, a, 'claim', { code, dailyLimit: 10 });
  assert.equal(claimStatus(s, headers).agentId, a.agentId);
  networkAction(s, a, 'revoke', { id: result.connection.id });
  assert.throws(() => claimStatus(s, headers), { code: 'CONNECTION_REVOKED' });
  assert.throws(() => networkAction(s, a, 'claim', { code }), {
    code: 'CONNECTION_REVOKED',
  });
  s.onboarding[0].expiresAt = 0;
  assert.throws(() => claimInfo(s, code), { code: 'CLAIM_EXPIRED' });
  const expired = bootstrapClient(
    s,
    { clientId: 'client-two', label: 'Expired' },
    'http://localhost',
  );
  s.onboarding[0].expiresAt = 0;
  assert.throws(
    () => claimStatus(s, { authorization: 'Bearer ' + expired.token }),
    { code: 'CLAIM_EXPIRED' },
  );
});
await test('pairing cannot replace a stable identity; rotation, expiry and leases are enforced', async () => {
  const s = emptyHub(),
    a = (await owner(s, 'alice')).actor,
    b = (await owner(s, 'bravo')).actor;
  const pair = networkAction(s, a, 'pair', { label: 'cli' });
  assert.throws(
    () =>
      pairClient(s, {
        code: pair.pairCode,
        clientId: 'same',
        expectedAgentId: b.agentId,
      }),
    { code: 'IDENTITY_MISMATCH' },
  );
  const c = pairClient(s, {
    code: pair.pairCode,
    clientId: 'same',
    expectedAgentId: a.agentId,
  });
  const auth = () => authenticate(s, { authorization: 'Bearer ' + c.token });
  const actor = auth();
  assert.equal(snapshot(s, a, 'http://localhost').connections[0].online, false);
  heartbeat(s, actor, { runId: 'run-one' });
  assert.equal(snapshot(s, a, 'http://localhost').connections[0].online, true);
  assert.ok(!('lease' in snapshot(s, null, 'http://localhost').agents[0]));
  assert.throws(() => heartbeat(s, actor, { runId: 'run-two' }), {
    code: 'AGENT_BUSY',
  });
  s.connections[0].lastSeenAt = Date.now() - 91000;
  assert.equal(snapshot(s, a, 'http://localhost').connections[0].online, false);
  const next = networkAction(s, a, 'pair', { label: 'cli' });
  pairClient(s, { code: next.pairCode, clientId: 'same' });
  assert.equal(s.agents.length, 2);
  assert.throws(auth, { code: 'CONNECTION_REVOKED' });
  const manual = networkAction(s, a, 'issue-token', {
    label: 'Remote MCP',
    dailyLimit: 10,
  });
  const mc = s.connections.find((c) => c.id === manual.connectionId);
  mc.expiresAt = 0;
  assert.throws(
    () => authenticate(s, { authorization: 'Bearer ' + manual.token }),
    { code: 'TOKEN_EXPIRED' },
  );
  const expired = networkAction(s, a, 'pair', { label: 'expired' });
  s.pairings.find((p) => p.id === expired.pairId).expiresAt = 0;
  assert.throws(
    () => pairClient(s, { code: expired.pairCode, clientId: 'x' }),
    { code: 'PAIR_EXPIRED' },
  );
});

await test('subscriptions route future signals, sender is server-owned, and acknowledgement never leaks peers', async () => {
  const s = emptyHub(),
    a = (await owner(s, 'alice')).actor,
    b = (await owner(s, 'bravo')).actor;
  networkAction(s, b, 'profile', {
    name: 'B',
    bio: 'Design',
    topic: '设计与创作',
    keywords: [],
  });
  const sub = networkAction(s, b, 'subscribe', {
    text: 'open-source',
    topics: ['开发与技术'],
  });
  const token = networkAction(s, b, 'issue-token', { label: 'Reader' }).token;
  const reader = authenticate(s, { authorization: 'Bearer ' + token });
  const payload = {
    title: 'Open-source cooperation',
    body: 'Testing subscriptions',
    topic: '开发与技术',
    type: '需求',
    agentId: b.agentId,
  };
  const pubPair=networkAction(s,a,'pair',{label:'publisher'});
  const pubToken=pairClient(s,{code:pubPair.pairCode,clientId:'publisher'});
  const publisher=authenticate(s,{authorization:'Bearer '+pubToken.token});
  assert.throws(()=>networkAction(s,a,'publish',payload),{code:'AGENT_REQUIRED'});
  const signal = networkAction(s, publisher, 'publish', payload);
  assert.equal(signal.matched[0].agentId, b.agentId);
  assert.equal(s.broadcasts[0].agentId, a.agentId);
  assert.equal(agentInbox(s, reader).entries.length, 1);
  assert.throws(() => acknowledge(s, reader, { cursor: s.sequence + 1 }), {
    code: 'INVALID_INPUT',
  });
  acknowledge(s, reader, { cursor: s.sequence });
  acknowledge(s, reader, { cursor: 0 });
  assert.equal(agentInbox(s, reader).entries.length, 0);
  networkAction(s, b, 'unsubscribe', { id: sub.subscriptionId });
  assert.equal(networkAction(s, publisher, 'publish', payload).matched.length, 0);
  assert.throws(
    () => networkAction(s, publisher, 'publish', { ...payload, source: 'not-url' }),
    { code: 'INVALID_INPUT' },
  );
});
