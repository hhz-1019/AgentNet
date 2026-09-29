import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentNet } from '../client/sdk.mjs';
import { normalizeDraft, saveOnboardingStep } from '../web/onboarding.ts';
import {
  assertAcceptanceTarget,
  acceptanceFetch,
} from './acceptance-target.mjs';
const endpoint = process.env.AGENTNET_TEST_URL || 'http://127.0.0.1:4321';
assertAcceptanceTarget(endpoint);
const run = Date.now().toString();
const directory = resolve('.agentnet-audit', 'core-' + run);
await mkdir(directory, { recursive: true });
const binary = resolve(
  process.env.AGENTNET_CLI || '.agentnet-audit/bin/agentnet-cli.exe',
);
function human() {
  const cookies = new Map();
  return async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const slot = cookies.get('ef_console_v2_active');
    const csrf =
      cookies.get(
        'ef_console_v2_csrf' + (slot && slot !== '0' ? '_' + slot : ''),
      ) || '';
    const response = await acceptanceFetch(endpoint + '/api/v2/' + path, {
      method,
      headers: {
        Origin: endpoint,
        Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0],
        i = pair.indexOf('=');
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const value = await response.json();
    if (
      !response.ok ||
      value.error ||
      (typeof value.code === 'number' && value.code !== 0)
    ) {
      const error = new Error(
        `${path}: ${response.status} ${value.error?.code || value.msg || ''}`,
      );
      error.code = value.error?.code;
      error.details = value.error?.details;
      throw error;
    }
    return value.data;
  };
}
async function join(name, existingOwner) {
  const client = new AgentNet({
    binary,
    home: resolve(directory, name),
    endpoint,
  });
  await client.connect();
  const identity = await client.register_agent({
    display_name: `Acceptance ${name} ${run}`,
    runtime_name: 'agentnet-protocol-test',
    draft: { identity_card: { agent_name: `Acceptance ${name} ${run}` } },
  });
  assert(identity.agent_id);
  const h = human();
  const link = new URL(identity.console_url);
  await h('console/handoffs/exchange', {
    ticket: link.searchParams.get('ticket'),
    browser_nonce: new URLSearchParams(link.hash.slice(1)).get('nonce'),
  });
  await assert.rejects(
    h('console/handoffs/exchange', {
      ticket: link.searchParams.get('ticket'),
      browser_nonce: new URLSearchParams(link.hash.slice(1)).get('nonce'),
    }),
    (error) => error.code === 'HANDOFF_INVALID',
  );
  assert.equal(
    (await h('console/session')).agent_id,
    identity.agent_id,
    'replayed ticket must not destroy the existing browser session',
  );
  const password = existingOwner?.password || `test-${crypto.randomUUID()}`;
  const owner = existingOwner
    ? await h('auth/uid/claim', { uid: existingOwner.uid, password })
    : await h('auth/uid/register', { password });
  assert(owner.uid.startsWith('u_'));
  if (!existingOwner) assert(owner.recovery_key.startsWith('rk_'));
  let draft = await h('agents/me/onboarding-draft');
  // A corrected prefill must update the existing draft, not allocate a new identity.
  const prefill = {
    identity_card: {
      human_description: 'Researches accessible infrastructure',
    },
    field_provenance: {
      'identity_card.human_description': 'agent_user_context',
    },
  };
  const corrected = await client.command(
    [
      'agent',
      'provision',
      '--require-existing-agent',
      '--mode',
      'skill',
      '--runtime-name',
      'agentnet-protocol-test',
      '--draft-file',
      '-',
    ],
    { input: prefill },
  );
  assert.equal(corrected.agent_id, identity.agent_id);
  draft = await h('agents/me/onboarding-draft');
  assert.equal(
    draft.draft.data.identity_card.human_description,
    prefill.identity_card.human_description,
  );
  assert.equal(
    draft.draft.field_provenance['identity_card.human_description']
      .value_source,
    'agent_user_context',
  );
  const data = {
    identity_card: {
      agent_name: `Acceptance ${name} ${run}`,
      agent_description: 'Operator-owned deployment acceptance test Agent',
      human_description: 'Integration test owner',
      working_languages: ['zh-CN'],
      offering: ['API verification'],
      seeking: ['Protocol collaborators'],
      geo: '',
      timezone: 'Asia/Shanghai',
      agent_status: [],
      human_status: [],
      interests_negative: [],
    },
    network_goal: 'Verify secure agent-to-agent collaboration',
    intent_actions: [],
    security_boundary: {
      recurring_publish: false,
      auto_reply_pm: true,
      auto_comment: false,
      show_add_friend: true,
    },
  };
  await h(
    'console/onboarding-draft',
    {
      expected_revision: draft.draft.revision,
      idempotency_key: crypto.randomUUID(),
      draft: data,
    },
    'PUT',
  );
  await client.command(
    [
      'agent',
      'provision',
      '--require-existing-agent',
      '--mode',
      'skill',
      '--runtime-name',
      'agentnet-protocol-test',
      '--draft-file',
      '-',
    ],
    { input: prefill },
  );
  draft = await h('agents/me/onboarding-draft');
  assert.equal(
    draft.draft.data.identity_card.human_description,
    data.identity_card.human_description,
    'Agent prefill must preserve the owner edit',
  );
  if (name === 'Helper') {
    // Reproduce legacy/Agent-generated drafts with no authorization object.
    const before = await h('agents/me/onboarding-draft');
    const withoutPermissions = { ...before.draft.data };
    delete withoutPermissions.security_boundary;
    await h(
      'console/onboarding-draft',
      {
        expected_revision: before.onboarding.revision,
        idempotency_key: crypto.randomUUID(),
        draft: withoutPermissions,
      },
      'PUT',
    );
  }
  for (let step = 2; step <= 5; step++) {
    draft = await h('agents/me/onboarding-draft');
    await saveOnboardingStep(
      h,
      draft,
      normalizeDraft(draft.draft.data),
      step,
      () => {},
    );
  }
  const session = await h('console/session');
  assert.equal(session.onboarding.state, 'completed');
  if (name === 'Helper') {
    const finalDraft = await h('agents/me/onboarding-draft');
    assert.deepEqual(Object.values(finalDraft.draft.data.security_boundary), [
      false,
      false,
      false,
      false,
    ]);
  }
  const card = await h('console/bff/agents/me/card/page');
  assert.equal(
    card.current_values.human_description,
    data.identity_card.human_description,
  );
  await client.heartbeat();
  return {
    client,
    h,
    id: identity.agent_id,
    uid: owner.uid,
    recoveryKey: owner.recovery_key,
    password,
  };
}
const a = await join('Atlas'),
  b = await join('Scout');
const helper = await join('Helper', a);
// First contact is part of completed onboarding, not a later background job.
let officialID;
for (const member of [a, b, helper]) {
  const relations = await member.h('console/relations/friends?limit=20');
  assert.equal(
    relations.friends.length,
    1,
    'New Agent starts with exactly one friend',
  );
  const id = relations.friends[0].peer_agent_id;
  const identity = relations.agent_contexts[id].identity_assertion;
  assert.match(identity.display_name, /^AgentNet 官方助手(?:#|$)/);
  assert.equal(identity.verification_level, 'official');
  if (officialID)
    assert.equal(id, officialID, 'All Agents share one official identity');
  officialID = id;
  const inbox = await member.h('console/pm/conversations');
  const welcome = inbox.conversations.filter((c) => c.peer_agent_id === id);
  assert.equal(welcome.length, 1);
  assert.equal(Number(welcome[0].msg_count), 1);
  assert.match(welcome[0].last_message.content, /欢迎加入 AgentNet/);
  assert(JSON.stringify(await member.client.get_relations()).includes(id));
  assert(
    JSON.stringify(await member.client.get_messages()).includes(
      '欢迎加入 AgentNet',
    ),
  );
}
await helper.client.command(['relation', 'unfriend', '--uid', officialID]);
assert.equal(
  ((await helper.h('console/relations/friends?limit=20')).friends || []).length,
  0,
);
console.log(
  'PASS: one official friend per Agent, real welcome in Dashboard and SDK, removable relationship',
);
assert.equal(helper.uid, a.uid);
const owned = await human()('auth/uid/login', {
  uid: a.uid,
  password: a.password,
});
assert.equal(owned.agents.length, 2);
assert.notEqual(helper.id, a.id);
console.log(
  'PASS: two independent Agent Homes, signed registration, human claim and onboarding',
);
const again = await a.client.register_agent({
  display_name: 'Atlas',
  runtime_name: 'agentnet-protocol-test',
});
assert.equal(again.agent_id, a.id);
console.log('PASS: same Home preserves network identity');
await a.client.create_relation({
  target_agent_id: b.id,
  greeting: 'Verify a private collaboration channel',
});
const requests = await b.client.get_relation_requests();
await writeFile(
  resolve(directory, 'relation-shape.json'),
  JSON.stringify(requests, null, 2),
);
const incoming =
  requests.requests ||
  requests.applications ||
  requests.friend_requests ||
  requests.items;
assert(
  Array.isArray(incoming) && incoming.length,
  'Expected a real incoming relation request',
);
const request =
  incoming.find(
    (x) => String(x.from_uid || x.from_agent_id || x.sender_id) === a.id,
  ) || incoming[0];
await b.client.respond_relation({
  request_id: String(request.request_id || request.id),
  action: 'accept',
});
console.log('PASS: relation request and acceptance');
await a.client.send_message({
  receiver_id: b.id,
  content: 'Please confirm the API protocol test.',
});
const messages = await b.client.get_messages();
assert(
  JSON.stringify(messages).includes('Please confirm the API protocol test.'),
);
await b.client.send_message({
  receiver_id: a.id,
  content: 'Protocol task completed: message received.',
});
assert(
  JSON.stringify(await a.client.get_messages()).includes(
    'Protocol task completed',
  ),
);
console.log('PASS: two-way private messaging through actual RPC services');
const command = await a.h('agent-commands', {
  command_type: 'human_instruction',
  payload: { instruction: 'Report a successful local runtime receipt' },
  idempotency_key: crypto.randomUUID(),
});
await a.client.get_context();
await a.client.heartbeat();
const claim = await a.client.claim_command({
  command_id: String(command.command_id),
});
await a.client.complete_command({
  command_id: String(command.command_id),
  claim_token: claim.claim_token,
  claim_epoch: claim.claim_epoch,
  status: 'completed',
  result: { summary: 'Real local test instruction processed' },
});
const activity = await a.h('console/activity?after=0&limit=100');
assert(activity.events.length > 0);
console.log(
  'PASS: owner instruction, runtime claim/complete and persisted activity',
);
const decision = await a.client.request_decision({
  title: 'Confirm a local read-only check',
  body: 'Local isolated test asks permission before checking its profile.',
  recommendation: 'Read the public profile to verify the identity.',
  choices: ['Run read-only check', 'Wait'],
});
assert.equal(decision.accepted, 1);
const attentionId = decision.items[0].attention_id;
const attention = await a.h(`console/attention-items/${attentionId}`);
const item = attention.attention_item || attention;
await a.h(`console/attention-items/${attentionId}/respond`, {
  action_key: 'choice_0',
  expected_item_revision: item.item_revision,
  idempotency_key: crypto.randomUUID(),
});
const queued = (await a.client.pending_commands()).commands.find(
  (c) => String(c.payload?.attention_id) === attentionId,
);
assert(queued);
const approvedClaim = await a.client.claim_command({
  command_id: queued.command_id,
});
assert.equal((await a.client.get_profile()).public.agent_id, a.id);
await a.client.complete_command({
  command_id: queued.command_id,
  claim_token: approvedClaim.claim_token,
  claim_epoch: approvedClaim.claim_epoch,
  status: 'completed',
  command_type: 'attention_response',
  result: {
    summary: 'Verified the actual public profile after owner approval.',
  },
});
console.log(
  'PASS: Agent requests decision, owner approves, actual read-only work completes with receipt',
);

const recovered = new AgentNet({
  binary,
  home: resolve(directory, 'Recovered'),
  endpoint,
});
const provision = await recovered.register_agent({
  display_name: 'Recover existing Atlas',
  runtime_name: 'agentnet-recovery-test',
  recover: true,
});
const recoverHuman = human(),
  recoverLink = new URL(provision.console_url);
await recoverHuman('console/handoffs/exchange', {
  ticket: recoverLink.searchParams.get('ticket'),
  browser_nonce: new URLSearchParams(recoverLink.hash.slice(1)).get('nonce'),
});
await assert.rejects(
  recoverHuman('auth/uid/claim', {
    uid: a.uid,
    password: 'incorrect-password',
    agent_id: a.id,
  }),
  { code: 'UID_AUTH_INVALID' },
);
await assert.rejects(
  recoverHuman('auth/uid/claim', {
    uid: b.uid,
    password: b.password,
    agent_id: a.id,
  }),
  { code: 'UID_AUTH_INVALID' },
);
const choices = await recoverHuman('auth/uid/login', {
  uid: a.uid,
  password: a.password,
});
assert(choices.agents.some((agent) => agent.agent_id === a.id));
await recoverHuman('auth/uid/claim', {
  uid: a.uid,
  password: a.password,
  agent_id: a.id,
});
assert.equal((await recovered.get_profile()).public.agent_id, a.id);
console.log(
  'PASS: fresh Home recovers the same network identity through verified owner confirmation',
);
const browserLogin = human();
await browserLogin('auth/uid/login', {
  uid: a.uid,
  password: a.password,
  agent_id: a.id,
});
assert.equal((await browserLogin('console/session')).owner_uid, a.uid);
const newPassword = `reset-${crypto.randomUUID()}`;
await assert.rejects(
  browserLogin('auth/uid/reset-password', {
    uid: a.uid,
    password: newPassword,
    recovery_key: 'wrong',
  }),
  { code: 'UID_AUTH_INVALID' },
);
const reset = await browserLogin('auth/uid/reset-password', {
  uid: a.uid,
  password: newPassword,
  recovery_key: a.recoveryKey,
});
assert.notEqual(reset.recovery_key, a.recoveryKey);
await assert.rejects(browserLogin('console/session'));
await assert.rejects(
  browserLogin('auth/uid/login', { uid: a.uid, password: a.password }),
  { code: 'UID_AUTH_INVALID' },
);
await assert.rejects(
  browserLogin('auth/uid/reset-password', {
    uid: a.uid,
    password: newPassword,
    recovery_key: a.recoveryKey,
  }),
  { code: 'UID_AUTH_INVALID' },
);
await browserLogin('auth/uid/login', {
  uid: a.uid,
  password: newPassword,
  agent_id: a.id,
});
assert.equal((await browserLogin('console/session')).agent_id, a.id);
const switchLink = new URL(
  (await helper.client.command(['agent', 'switch-account'])).console_url,
);
const switchBrowser = human();
await switchBrowser('console/handoffs/exchange', {
  ticket: switchLink.searchParams.get('ticket'),
  browser_nonce: new URLSearchParams(switchLink.hash.slice(1)).get('nonce'),
});
await switchBrowser('auth/uid/switch', {
  uid: a.uid,
  password: newPassword,
  agent_id: a.id,
});
assert.equal(
  (await switchBrowser('console/account-switch')).status,
  'completed',
);
assert.equal((await helper.client.get_profile()).public.agent_id, a.id);
console.log(
  'PASS: an existing runtime switches to another owned Agent through UID confirmation',
);
for (const path of [
  'auth/email/challenges',
  'account-email-bindings/challenges',
]) {
  await assert.rejects(browserLogin(path, { email: 'someone@example.com' }));
}
const legacy = await fetch(endpoint + '/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login_method: 'email', email: 'someone@example.com' }),
});
const legacyBody = await legacy.json();
assert(
  legacy.status >= 400 || (legacyBody.code && legacyBody.code !== 0),
  'legacy email login must be disabled',
);
console.log(
  'PASS: UID browser login, wrong-password/cross-owner rejection, one-time recovery rotation, session revocation, email login disabled',
);
const dashboard = await a.client.dashboard();
await writeFile(
  resolve('.agentnet-audit/core-smoke-state.json'),
  JSON.stringify(
    {
      directory,
      endpoint,
      a: { id: a.id, uid: a.uid },
      b: { id: b.id, uid: b.uid },
      official: { id: officialID, removed_by: helper.id },
      dashboard,
    },
    null,
    2,
  ),
);
console.log(
  'Real model processing was NOT tested. UID authentication used ordinary passwords without OTP or mail services.',
);
