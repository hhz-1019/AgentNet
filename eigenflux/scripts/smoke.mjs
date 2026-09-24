import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentNet } from '../client/sdk.mjs';
const endpoint = process.env.AGENTNET_TEST_URL || 'http://127.0.0.1:4321';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname))
  throw Error('This test is restricted to an isolated loopback deployment');
const otp = process.env.AGENTNET_TEST_OTP;
if (!otp)
  throw Error(
    'Set AGENTNET_TEST_OTP for the isolated test server; never enable fixed OTP in production',
  );
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
    const response = await fetch(endpoint + '/api/v2/' + path, {
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
    )
      throw Error(
        `${path}: ${response.status} ${value.error?.code || value.msg || ''}`,
      );
    return value.data;
  };
}
async function join(name) {
  const client = new AgentNet({
    binary,
    home: resolve(directory, name),
    endpoint,
  });
  await client.connect();
  const identity = await client.register_agent({
    display_name: name,
    runtime_name: 'agentnet-protocol-test',
  });
  assert(identity.agent_id);
  const h = human();
  const link = new URL(identity.console_url);
  await h('console/handoffs/exchange', {
    ticket: link.searchParams.get('ticket'),
    browser_nonce: new URLSearchParams(link.hash.slice(1)).get('nonce'),
  });
  const email = `${name.toLowerCase()}-${run}@agentnet.invalid`;
  const challenge = await h('account-email-bindings/challenges', { email });
  await h('account-email-bindings/verify', {
    email,
    challenge_id: challenge.challenge_id,
    otp,
  });
  let draft = await h('agents/me/onboarding-draft');
  const data = {
    identity_card: {
      agent_name: name,
      agent_description: 'A real local protocol test runtime',
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
  for (let step = 2; step <= 5; step++) {
    draft = await h('agents/me/onboarding-draft');
    await h('agents/me/onboarding-draft/confirm', {
      step,
      expected_onboarding_revision: draft.onboarding.revision,
      idempotency_key: crypto.randomUUID(),
    });
  }
  const session = await h('console/session');
  assert.equal(session.onboarding.state, 'completed');
  await client.heartbeat();
  return { client, h, id: identity.agent_id, email };
}
const a = await join('Atlas'),
  b = await join('Scout');
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
const dashboard = await a.client.dashboard();
await writeFile(
  resolve('.agentnet-audit/core-smoke-state.json'),
  JSON.stringify(
    {
      directory,
      endpoint,
      a: { id: a.id, email: a.email },
      b: { id: b.id, email: b.email },
      dashboard,
    },
    null,
    2,
  ),
);
console.log(
  'Model processing and real email delivery were NOT tested. Local fixed OTP was used only on this isolated test deployment.',
);
