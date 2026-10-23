import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentNet } from '../client/sdk.mjs';
import { normalizeDraft, saveOnboardingStep } from '../web/onboarding.ts';
import {
  assertAcceptanceTarget,
  acceptanceFetch,
} from './acceptance-target.mjs';
const endpoint = process.env.AGENTNET_TEST_URL || 'http://127.0.0.1:4321';
assertAcceptanceTarget(endpoint);
// Full-service smoke uses pre-created test owners. Registration/OTP behavior is
// exercised separately by test:phone:core, without adding a production bypass.
let testOwners;
try {
  testOwners = JSON.parse(
    await readFile(
      process.env.AGENTNET_SMOKE_OWNERS_FILE ||
        '.agentnet-audit/test-owners.json',
      'utf8',
    ),
  );
} catch {
  throw Error(
    'Provide verified test owners via AGENTNET_SMOKE_OWNERS_FILE; isolated CI runs seed-test-owners.mjs first.',
  );
}

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
async function join(name) {
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
  const avatar = await client.upload_avatar({
    local_path: resolve('elsewhere/web/public/preview-assets/linjian.png'),
  });
  assert.match(avatar.avatar, /^\/api\/v2\/public\/avatars\/[a-f0-9]{32}$/);
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
    {
      input: {
        twin_profile: {
          portrait: {
            fields: {
              name: '验收主人',
              avatar: avatar.avatar,
              interests: '小说与城市散步',
              recent: '认识愿意慢慢聊书的人',
            },
            memories: [
              {
                id: crypto.randomUUID(),
                content:
                  '明确标注的模拟记忆：重读小说之后，想继续聊没有想明白的问题。',
              },
            ],
          },
        },
      },
    },
  );
  await assert.rejects(
    client.comment({
      post_id: '1',
      content: '尚未注册不能评论',
      idempotency_key: crypto.randomUUID(),
    }),
  );
  const h = human();
  const link = new URL(identity.console_url);
  await h('console/handoffs/exchange', {
    ticket:
      new URLSearchParams(link.hash.slice(1)).get('connect') ||
      link.searchParams.get('ticket'),
    browser_nonce: new URLSearchParams(link.hash.slice(1)).get('nonce') || '',
  });
  await h('console/handoffs/exchange', {
    ticket:
      new URLSearchParams(link.hash.slice(1)).get('connect') ||
      link.searchParams.get('ticket'),
    browser_nonce: new URLSearchParams(link.hash.slice(1)).get('nonce') || '',
  });
  assert.equal(
    (await h('console/session')).agent_id,
    identity.agent_id,
    'reopened registration page must preserve the same browser session',
  );
  const credential = testOwners[name];
  assert(
    credential?.uid && credential.password && credential.recoveryKey,
    'Missing isolated test owner credentials',
  );
  const password = credential.password;
  const owner = await h('auth/uid/claim', { uid: credential.uid, password });
  owner.recovery_key = credential.recoveryKey;
  assert.match(owner.uid, /^[1-9]\d{4,}$/);
  let draft = await h('agents/me/onboarding-draft');
  assert.equal(
    draft.draft.data.twin_profile.portrait.fields.avatar,
    avatar.avatar,
    'Agent-uploaded avatar must reach the owner review draft',
  );
  assert.equal(draft.draft.data.twin_profile.portrait.memories, undefined);
  assert.equal(draft.draft.data.twin_profile.memory_mode, 'host');
  assert.equal(draft.draft.data.twin_profile.portrait.fields.recent, undefined);
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
  if (name === 'Atlas') {
    const settings = (await h('console/companion')).settings;
    await h(
      'console/companion',
      {
        ...settings,
        agent_name: '林间验收',
        connection_goal: '认识愿意慢慢聊书、交换散步见闻的人',
      },
      'PUT',
    );
    const saved = await h(
      'console/portrait',
      {
        expected_revision: 0,
        fields: {
          name: '验收主人',
          bio: '隔离验收 Agent，关注阅读与开放合作',
          interests: '小说与城市散步',
          offers: '分享读后感与散步见闻',
          connections: '想认识能一起聊读后问题的人',
          avatar: avatar.avatar,
        },
        visible: ['name', 'interests'],
      },
      'PUT',
    );
    await h('console/portrait/confirm', {
      revision: saved.revision,
      agreed: true,
    });
    const portrait = await client.get_portrait();
    assert.equal(portrait.fields.avatar, avatar.avatar);
    assert.equal(portrait.memories.length, 0);
    assert.equal(portrait.memory_mode, 'host');
    assert.equal(portrait.fields.offers, '分享读后感与散步见闻');
    assert.equal(
      (await client.get_companion()).settings.agent_name,
      '林间验收',
    );
    assert.equal((await client.get_activity_policy()).daily_posts, 10);
    assert.ok((await client.get_context()).context_revision > 0);
    const accountPage = new URL((await client.command(['dashboard'])).url);
    assert.equal(accountPage.pathname, '/dashboard');
    assert.equal(accountPage.searchParams.get('account'), credential.uid);
    await h('console/handoffs/exchange', {
      ticket: new URLSearchParams(link.hash.slice(1)).get('connect'),
    });
    assert.equal((await h('console/session')).owner_bound, true);
    assert.equal((await h('console/portrait')).fields.avatar, avatar.avatar);
    console.log(
      'PASS: concise onboarding activates same CLI, avatar, host memory mode, companion and default quota',
    );
  } else {
    // Legacy step confirmation also requires the same concise, reviewed card.
    const settings = (await h('console/companion')).settings;
    await h(
      'console/companion',
      { ...settings, connection_goal: data.network_goal },
      'PUT',
    );
    await h(
      'console/portrait',
      {
        expected_revision: 0,
        fields: {
          bio: '隔离验收 Agent，关注协议协作',
          interests: '开放协议与工具协作',
          offers: '分享接口验收方法',
          avatar: avatar.avatar,
        },
        visible: ['bio', 'interests'],
      },
      'PUT',
    );
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
  if (name !== 'Atlas')
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
const helper = await join('Helper');
// Owner settings and Agent settings must refer to the same isolated identity.
const preferences = 'console/community-preferences';
await assert.rejects(human()(preferences));
await assert.rejects(human()(preferences, { official_pm_optout: true }, 'PUT'));
assert.equal((await a.h(preferences)).official_pm_optout, false);
for (const invalid of [
  {},
  { official_pm_optout: null },
  { official_pm_optout: 'false' },
]) {
  await assert.rejects(a.h(preferences, invalid, 'PUT'));
}
await a.h(preferences, { official_pm_optout: true }, 'PUT');
assert.equal((await a.h(preferences)).official_pm_optout, true);
assert.equal((await b.h(preferences)).official_pm_optout, false);
assert.equal((await helper.h(preferences)).official_pm_optout, false);
await a.h(preferences, { official_pm_optout: false }, 'PUT');
assert.equal((await a.h(preferences)).official_pm_optout, false);
console.log(
  'PASS: community preference authentication, strict boolean validation, persistence and Agent isolation',
);
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
  assert.match(identity.display_name, /^elsewhere 官方助手(?:#|$)/);
  assert.equal(identity.verification_level, 'official');
  if (officialID)
    assert.equal(id, officialID, 'All Agents share one official identity');
  officialID = id;
  const inbox = await member.h('console/pm/conversations');
  const welcome = inbox.conversations.filter((c) => c.peer_agent_id === id);
  assert.equal(welcome.length, 1);
  assert.equal(Number(welcome[0].msg_count), 1);
  assert.match(welcome[0].last_message.content, /欢迎加入 elsewhere/);
  assert(JSON.stringify(await member.client.get_relations()).includes(id));
  assert(
    JSON.stringify(await member.client.get_messages()).includes(
      '欢迎加入 elsewhere',
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
assert.notEqual(helper.uid, a.uid);
const owned = await human()('auth/uid/login', {
  uid: a.uid,
  password: a.password,
});
assert.equal(owned.agents.length, 1);
assert.equal(owned.agents[0].agent_id, a.id);
assert.notEqual(helper.id, a.id);
console.log(
  'PASS: three independent accounts and Agent Homes, one identity per owner, signed registration, human claim and onboarding',
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
const shareImage = await a.client.upload_image({
  local_path: resolve('elsewhere/web/public/preview-assets/linjian.png'),
  alt: '隔离协议验收使用的模拟配图',
});
const share = {
  owner_authorized: true,
  visibility: 'friends',
  work_id: 'isolated-social-acceptance',
  status: 'completed',
  shareable: true,
  title: '隔离环境发帖验收',
  source: '本次隔离验收中的实际双向私信测试。',
  result:
    '两个测试身份已通过真实服务完成双向私信，现检查分享的持久化、好友可见范围和重试幂等性。',
  evidence: '本脚本已读回双方消息并核对正文。',
  limitations: '仅证明隔离后端联通，不代表线上部署或广播模型处理完成。',
  tags: ['联调验收'],
  media: [shareImage.media || shareImage],
};
const shared = await a.client.share_work(share);
assert.equal(shared.state, 'published');
assert.equal(shared.document.identity, 'agent');
assert.equal((await a.client.share_work(share)).id, shared.id);
assert((await b.client.get_work_posts({ scope: 'latest' })).items.some((p) => p.id === shared.id));
assert(
  !(await helper.client.get_work_posts({ scope: 'latest' })).items.some((p) => p.id === shared.id),
);
assert(
  (await a.h('console/social/posts?scope=mine')).items.some(
    (p) => p.id === shared.id,
  ),
);
console.log(
  'PASS: Agent social post persisted, visible in Console and to friend, hidden from nonfriend, retry deduplicated',
);
const handoffPacket = {
  receiver_id: b.id,
  title: '隔离测试项目交接',
  summary: '收到后仅提醒，由主人决定是否执行。',
  markdown: '# 项目说明\n这是隔离验收资料，不需要执行任何任务。',
  sources: [],
  idempotency_key: crypto.randomUUID(),
  owner_authorized: true,
};
const handoff = await a.client.send_handoff(handoffPacket);
assert.equal(handoff.execution_authorized, false);
assert.equal((await a.client.send_handoff(handoffPacket)).id, handoff.id);
for (let i = 0; i < 2; i++) {
  assert(
    (await b.client.get_handoffs()).items.some((x) => x.id === handoff.id),
  );
}
assert.equal(
  (await b.client.get_handoff({ handoff_id: handoff.id })).markdown,
  handoffPacket.markdown,
);
await assert.rejects(helper.client.get_handoff({ handoff_id: handoff.id }));
await assert.rejects(
  a.client.acknowledge_handoff({
    handoff_id: handoff.id,
    owner_acknowledged: true,
  }),
);
await b.client.acknowledge_handoff({
  handoff_id: handoff.id,
  owner_acknowledged: true,
});
assert(!(await b.client.get_handoffs()).items.some((x) => x.id === handoff.id));
assert.equal(
  (await b.client.get_handoff({ handoff_id: handoff.id })).state,
  'acknowledged',
);
console.log(
  'PASS: authenticated private handoff, durable inbox, retry, third-party isolation and recipient acknowledgement',
);
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
// Activity is projected asynchronously from the stream, after the command commits.
let activity;
for (let attempt = 0; attempt < 20; attempt++) {
  activity = await a.h('console/activity?after=0&limit=100');
  if (activity.events?.length) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert(
  activity.events?.length > 0,
  'Activity projection did not arrive within 10 seconds',
);
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

// Exercise Moment through the complete authenticated stack, in addition to
// the legacy Attention contract above. No real-user account is used here.
const executorID = 'isolated_moment_host';
const scope = '仅读取测试账号的公开资料，不修改资料，不发送消息或发布内容。';
const scopedDecision = await a.client.request_decision({
  title: '核对测试账号资料？',
  body: '隔离验收将通过已绑定宿主读取测试账号的公开资料。',
  recommendation: '只读取并核对当前身份。',
  choices: ['只读核对'],
  scopes: [scope],
  executor_id: executorID,
  related_agent_id: b.id,
});
const scopedID = scopedDecision.items[0].attention_id;
const momentItem = async () =>
  (await a.h('console/moment')).items.find((i) => i.attention_id === scopedID);
await assert.rejects(human()('console/moment'));
assert(
  !(await b.h('console/moment')).items.some((i) => i.attention_id === scopedID),
);
const beforeDecision = await momentItem();
assert.equal(beforeDecision.related_agent.agent_id, b.id);
const condition = '只确认当前身份，不联系任何人。';
const response = await a.h(`console/attention-items/${scopedID}/respond`, {
  action_key: 'choice_0',
  expected_item_revision: beforeDecision.item_revision,
  idempotency_key: crypto.randomUUID(),
  condition,
});
const savedDecision = await momentItem();
assert(['pending', 'notified'].includes(savedDecision.command.status));
assert.equal(savedDecision.command.condition, condition);
const scopedQueue = await a.client.pending_commands({
  command_type: 'attention_response',
  executor_id: executorID,
});
assert(scopedQueue.commands.some((c) => c.command_id === response.command_id));
await assert.rejects(
  a.client.claim_command({
    command_id: response.command_id,
    executor_id: 'wrong_host',
  }),
);
const scopedClaim = await a.client.claim_command({
  command_id: response.command_id,
  executor_id: executorID,
});
assert.equal(scopedClaim.payload.authorization_scope, scope);
assert.equal(scopedClaim.payload.condition, condition);
const proof = {
  command_id: response.command_id,
  claim_token: scopedClaim.claim_token,
  claim_epoch: scopedClaim.claim_epoch,
};
assert(
  (await a.client.renew_command({ ...proof, executor_id: executorID }))
    .claim_until > Date.now(),
);
assert.equal((await momentItem()).command.status, 'claimed');
assert.equal((await a.client.get_profile()).public.agent_id, a.id);
const receipt = {
  ...proof,
  command_type: 'attention_response',
  status: 'completed',
  result: { summary: '通过真实服务读回并核对了测试账号的公开身份。' },
};
await a.client.complete_command(receipt);
await a.client.complete_command(receipt);
const afterDecision = await momentItem();
assert.equal(afterDecision.command.status, 'completed');
assert.equal(afterDecision.command.result.summary, receipt.result.summary);
assert.equal(afterDecision.command.authorization_scope, scope);
console.log(
  'PASS: authenticated Moment list, owner isolation, peer grouping, saved decision, bound claim, renewal and visible deduplicated receipt',
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
  ticket:
    new URLSearchParams(recoverLink.hash.slice(1)).get('connect') ||
    recoverLink.searchParams.get('ticket'),
  browser_nonce:
    new URLSearchParams(recoverLink.hash.slice(1)).get('nonce') || '',
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
await assert.rejects(
  recoverHuman('auth/uid/claim', {
    uid: a.uid,
    password: a.password,
  }),
  { code: 'OWNER_HAS_AGENT' },
);
await recoverHuman('auth/uid/claim', {
  uid: a.uid,
  password: a.password,
  agent_id: a.id,
});
assert.equal((await recovered.get_profile()).public.agent_id, a.id);
console.log(
  'PASS: owner cannot claim a second identity; fresh Home recovers the existing identity through verified confirmation',
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
  'Real model processing was NOT tested. UID login used pre-created isolated owner fixtures; run test:phone:core for OTP registration coverage.',
);
