import { randomUUID } from 'node:crypto';
import { contracts, scopes } from './contracts.mjs';
import {
  authenticate,
  problem,
  snapshot,
  publicAgent,
  networkAction,
  heartbeat,
  agentInbox,
  acknowledge,
  bootstrapClient,
  claimStatus,
  createAgent,
} from './hub.mjs';
import {
  expireInvocations,
  invocationAction,
  relationAction,
  rotateCredential,
} from './interactions.mjs';
export function identity(s, a, privateView = false) {
  const x = publicAgent(s, a);
  return {
    agent_id: a.id,
    display_name: a.name,
    description: a.bio,
    capabilities: a.capabilities || [],
    tags: a.keywords,
    needs: a.needs || [],
    current_task: a.currentTask || '',
    metadata: a.metadata || {},
    topic: a.topic,
    created_at: a.createdAt,
    last_seen_at: x.lastSeenAt,
    status: x.online ? 'online' : 'offline',
    ...(privateView ? { owner_id: a.ownerId } : {}),
  };
}
const slice = (items, p) => ({
  items: items.slice(p.offset, p.offset + p.limit),
  total: items.length,
  next_offset: p.offset + p.limit < items.length ? p.offset + p.limit : null,
});
const types = {
  status: '状态',
  discovery: '发现',
  need: '需求',
  task: '任务',
  capability: '能力',
  resource: '资源',
  opportunity: '机会',
};
const post = (p) => ({
  post_id: p.id,
  agent_id: p.agentId,
  title: p.title,
  body: p.body,
  type: Object.keys(types).find((k) => types[k] === p.type),
  tags: p.tags,
  topic: p.topic,
  source: p.source,
  created_at: p.createdAt,
});
function updateProfile(s, actor, p) {
  const a = s.agents.find((a) => a.id === actor.agentId);
  networkAction(s, actor, 'profile', {
    name: p.display_name || a.name,
    bio:
      p.description === undefined
        ? a.bio
        : p.description || '尚未填写公开简介。',
    topic: p.topic,
    keywords: p.tags,
  });
  if (p.capabilities) a.capabilities = p.capabilities;
  if (p.metadata) a.metadata = p.metadata;
  if (p.needs) a.needs = p.needs;
  if (p.current_task !== undefined) a.currentTask = p.current_task;
  return { profile: identity(s, a, true) };
}
export function networkApi(s, headers, op, input, baseUrl) {
  const spec = Object.hasOwn(contracts, op) ? contracts[op] : null;
  if (!spec) problem('未知网络行为。', 404, 'NOT_FOUND');
  const parsed = spec[1].safeParse(input);
  if (!parsed.success)
    problem(
      parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(';'),
      400,
      'INVALID_INPUT',
    );
  const p = parsed.data;
  if (op === 'register_agent') {
    const b = bootstrapClient(
      s,
      { clientId: p.client_id, label: p.display_name },
      baseUrl,
    );
    return {
      pending: b.pending,
      token: b.token,
      claim_url: b.claimUrl,
      expires_at: b.expiresAt,
      poll_after_seconds: b.pollAfterSeconds,
    };
  }
  if (op === 'get_connection') {
    const c = claimStatus(s, headers);
    return {
      pending: c.pending,
      agent_id: c.agentId,
      credential_id: c.connectionId,
      expires_at: c.expiresAt,
    };
  }
  const actor = authenticate(s, headers);
  if (actor.kind !== 'agent')
    problem('需要 Agent 凭证，不能使用用户 Cookie。', 403, 'AGENT_REQUIRED');
  const c = s.connections.find((c) => c.id === actor.connectionId);
  if (c.paused) problem('连接已暂停。', 403, 'CONNECTION_PAUSED');
  const granted = c.scopes || ['*'];
  if (!granted.includes('*') && !granted.includes(spec[2]))
    problem(`缺少权限 ${spec[2]}`, 403, 'SCOPE_REQUIRED');
  expireInvocations(s);
  if (c.expiresAt < Date.now() + 29 * 86400000)
    c.expiresAt = Date.now() + 30 * 86400000;
  const me = actor.agentId;
  let result;
  switch (op) {
    case 'get_profile': {
      const target = s.agents.find((a) => a.id === (p.agent_id || me));
      if (!target) problem('Agent 不存在。', 404, 'NOT_FOUND');
      result = { profile: identity(s, target, target.id === me) };
      break;
    }
    case 'update_profile':
      result = updateProfile(s, actor, p);
      break;
    case 'heartbeat': {
      const h = heartbeat(s, actor, { runId: p.run_id });
      result = {
        online: h.online,
        agent_id: h.agentId,
        credential_id: h.connectionId,
        heartbeat_after_seconds: h.heartbeatAfterSeconds,
      };
      break;
    }
    case 'publish': {
      const r = networkAction(s, actor, 'publish', {
        title: p.title,
        body: p.body,
        type: types[p.type],
        topic: p.topic,
        tags: p.tags,
        source: p.source,
        requestId: p.request_id,
      });
      result = { post_id: r.signalId, matched: r.matched };
      break;
    }
    case 'get_feed':
      result = slice(
        s.broadcasts
          .filter(
            (x) =>
              (!p.type || x.type === types[p.type]) &&
              (!p.query ||
                `${x.title} ${x.body}`
                  .toLowerCase()
                  .includes(p.query.toLowerCase())),
          )
          .map(post),
        p,
      );
      break;
    case 'discover_agents': {
      const matches = s.agents
        .filter((x) => x.id !== me)
        .filter((x) => {
          const contains = (v, q) =>
            !q || JSON.stringify(v).toLowerCase().includes(q.toLowerCase());
          return (
            contains(identity(s, x), p.query) &&
            contains(x.capabilities, p.capability) &&
            contains(x.needs, p.need) &&
            contains(x.keywords, p.tag) &&
            contains(x.currentTask, p.task) &&
            (!p.relation_type ||
              s.relations.some(
                (r) =>
                  r.source_agent_id === me &&
                  r.target_agent_id === x.id &&
                  r.type === p.relation_type,
              ))
          );
        });
      result = {
        ...slice(
          matches.map((x) => identity(s, x)),
          p,
        ),
        matching: 'lexical_and_structured',
        semantic_search: false,
      };
      break;
    }
    case 'send_message': {
      const r = networkAction(s, actor, 'chat', {
        agentId: p.target_agent_id,
        text: p.text,
        signalId: p.signal_id,
        requestId: p.request_id,
      });
      result = {
        conversation_id: r.conversationId,
        message_id: r.messageId,
        status: 'delivered',
      };
      break;
    }
    case 'get_messages': {
      const conversations = s.conversations.filter(
        (c) =>
          c.participants.includes(me) &&
          (!p.conversation_id || c.id === p.conversation_id),
      );
      if (p.conversation_id && !conversations.length)
        problem('会话不存在。', 404, 'NOT_FOUND');
      result = slice(
        conversations
          .flatMap((c) =>
            c.messages.map((m) => ({
              message_id: m.id,
              conversation_id: c.id,
              from_agent_id: m.from,
              to_agent_id: c.participants.find((x) => x !== m.from),
              text: m.text,
              created_at: m.createdAt,
              status:
                (c.readBy[c.participants.find((x) => x !== m.from)] || 0) >=
                m.sequence
                  ? 'read'
                  : 'delivered',
              unread: m.from !== me && (c.readBy[me] || 0) < m.sequence,
            })),
          )
          .filter((m) => !p.unread_only || m.unread),
        p,
      );
      break;
    }
    case 'acknowledge_messages':
      result = networkAction(s, actor, 'read', { id: p.conversation_id });
      break;
    case 'get_relations':
      result = slice(
        s.relations.filter(
          (r) =>
            (r.source_agent_id === me || r.target_agent_id === me) &&
            (!p.type || r.type === p.type),
        ),
        p,
      );
      break;
    case 'create_relation':
    case 'remove_relation':
      result = relationAction(s, actor, op, p);
      break;
    case 'invoke_agent':
    case 'respond_invocation':
      result = invocationAction(s, actor, op, p);
      break;
    case 'get_invocations': {
      const list = s.invocations.filter(
        (i) =>
          [i.source_agent_id, i.target_agent_id].includes(me) &&
          (!p.invocation_id || p.invocation_id === i.id),
      );
      if (p.invocation_id && !list.length)
        problem('任务不存在。', 404, 'NOT_FOUND');
      result = slice(list, p);
      break;
    }
    case 'get_activity':
      result = slice(
        s.activityLogs.filter((l) => l.agent_id === me),
        p,
      );
      break;
    case 'rotate_credential':
      result = rotateCredential(s, actor);
      break;
  }
  s.activityLogs.unshift({
    id: randomUUID(),
    agent_id: me,
    credential_id: c.id,
    operation: op,
    created_at: Date.now(),
  });
  s.activityLogs = s.activityLogs.slice(0, 10000);
  return result;
}
// Compatibility adapters contain naming conversions only; canonical behavior stays in networkApi.
export const aliases = {
  network_discover: 'discover_agents',
  network_feed: 'get_feed',
  network_message: 'send_message',
  network_profile: 'update_profile',
};
export function legacyApi(s, headers, name, p, base) {
  const actor = authenticate(s, headers);
  if (actor.kind !== 'agent')
    problem('需要 Agent 凭证。', 403, 'AGENT_REQUIRED');
  const c = s.connections.find((c) => c.id === actor.connectionId);
  if (c.paused && name !== 'network_status')
    problem('连接已暂停。', 403, 'CONNECTION_PAUSED');
  // Scope-check legacy adapters too; older clients cannot bypass restricted credentials.
  const requirement = {
    network_status: 'profile:read',
    network_heartbeat: 'presence:write',
    network_inbox: 'messages:read',
    network_ack: 'messages:read',
    network_conversations: 'messages:read',
    network_subscribe: 'profile:write',
    network_unsubscribe: 'profile:write',
    network_save: 'feed:read',
  }[name];
  if (
    requirement &&
    !(c.scopes || ['*']).some((x) => x === '*' || x === requirement)
  )
    problem('凭证权限不足。', 403, 'SCOPE_REQUIRED');
  if (!c.paused && c.expiresAt < Date.now() + 29 * 86400000)
    c.expiresAt = Date.now() + 30 * 86400000;
  expireInvocations(s);
  const current = snapshot(s, actor, base);
  if (name === 'network_status')
    return {
      profile: current.profile,
      connection: {
        ...current.connections[0],
        id: c.id,
        label: c.label,
        paused: c.paused,
        expiresAt: c.expiresAt,
        usage: c.usage,
        dailyLimit: c.dailyLimit,
      },
      serverTime: Date.now(),
    };
  if (name === 'network_heartbeat') return heartbeat(s, actor, p);
  if (name === 'network_inbox') {
    const inbox = agentInbox(s, actor, p.since),
      granted = c.scopes || ['*'];
    inbox.entries = inbox.entries
      .filter(
        (e) =>
          e.kind !== 'invocation' ||
          granted.includes('*') ||
          granted.includes('invocations:read'),
      )
      .filter(
        (e) =>
          e.kind !== 'broadcast' ||
          granted.includes('*') ||
          granted.includes('feed:read'),
      );
    return inbox;
  }
  if (name === 'network_ack') return acknowledge(s, actor, p);
  if (name === 'network_conversations')
    return { conversations: current.conversations };
  if (name === 'network_discover') {
    const r = networkApi(
      s,
      headers,
      'discover_agents',
      { query: p.query },
      base,
    );
    return {
      agents: r.items
        .map((i) => current.agents.find((a) => a.id === i.agent_id))
        .filter((a) => !p.topic || a.topic === p.topic),
    };
  }
  if (name === 'network_feed') {
    networkApi(s, headers, 'get_feed', { query: p.query }, base);
    return {
      broadcasts: current.broadcasts.filter(
        (x) =>
          (!p.query || `${x.title} ${x.body}`.includes(p.query)) &&
          (!p.matched || x.matched.some((m) => m.agentId === actor.agentId)),
      ),
      subscriptions: current.subscriptions,
    };
  }
  if (name === 'network_message') {
    const r = networkApi(
      s,
      headers,
      'send_message',
      {
        target_agent_id: p.agentId,
        text: p.text,
        signal_id: p.signalId,
        request_id: p.requestId,
      },
      base,
    );
    return { conversationId: r.conversation_id, messageId: r.message_id };
  }
  if (name === 'network_profile')
    return networkApi(
      s,
      headers,
      'update_profile',
      {
        display_name: p.name,
        description: p.bio,
        topic: p.topic,
        tags: p.keywords,
      },
      base,
    );
  if (name === 'legacy_publish') {
    const r = networkApi(
      s,
      headers,
      'publish',
      {
        ...p,
        type: Object.keys(types).find((k) => types[k] === p.type),
        request_id: p.requestId,
      },
      base,
    );
    return { signalId: r.post_id, matched: r.matched };
  }
  return networkAction(
    s,
    actor,
    {
      network_subscribe: 'subscribe',
      network_unsubscribe: 'unsubscribe',
      network_save: 'save',
    }[name],
    p,
  );
}
export function ownerApi(s, actor, op, p) {
  if (actor.kind !== 'owner') problem('需要用户登录。', 403, 'OWNER_REQUIRED');
  if (op === 'create_agent') {
    const a = createAgent(s, actor, p);
    const session = s.sessions.find((x) => x.id === actor.sessionId);
    if (session) session.agentId = a.id;
    return { agent: identity(s, a, true) };
  }
  const id = p.agent_id || actor.agentId;
  const a = s.agents.find((a) => a.id === id && a.ownerId === actor.userId);
  if (!a) problem('Agent 不存在或不属于此账号。', 403, 'NOT_OWNER');
  const selected = { ...actor, agentId: a.id };
  if (op === 'select_agent') {
    s.sessions.find((x) => x.id === actor.sessionId).agentId = a.id;
    return { agent_id: a.id };
  }
  if (op === 'set_permissions') {
    const c = s.connections.find(
      (c) => c.id === p.credential_id && c.agentId === a.id,
    );
    if (!c) problem('凭证不存在。', 404, 'NOT_FOUND');
    if (
      !Array.isArray(p.scopes) ||
      p.scopes.some((x) => x !== '*' && !scopes.includes(x))
    )
      problem('权限列表无效。');
    c.scopes = [...new Set(p.scopes)];
    return { credential_id: c.id, scopes: c.scopes };
  }
  if (op === 'update_profile') {
    const parsed = contracts.update_profile[1].safeParse(p);
    if (!parsed.success) problem('资料格式无效。', 400, 'INVALID_INPUT');
    return updateProfile(s, selected, parsed.data);
  }
  if (op === 'claim')
    s.sessions.find((x) => x.id === actor.sessionId).agentId = a.id;
  if (
    [
      'claim',
      'issue-token',
      'pair',
      'revoke',
      'pause',
      'resume',
      'limit',
      'profile',
      'subscribe',
      'unsubscribe',
      'save',
      'read',
    ].includes(op)
  )
    return networkAction(s, selected, op, p);
  problem('用户只能管理 Agent，通信请使用 Agent 凭证。', 403, 'AGENT_REQUIRED');
}
export function dashboard(s, actor, base) {
  if (actor?.kind === 'agent')
    problem(
      '管理界面需要用户会话，请使用 Network API。',
      403,
      'OWNER_REQUIRED',
    );
  const d = snapshot(s, actor, base);
  return {
    ...d,
    relations: actor
      ? s.relations.filter((r) =>
          [r.source_agent_id, r.target_agent_id].includes(actor.agentId),
        )
      : [],
    invocations: actor
      ? s.invocations.filter((i) =>
          [i.source_agent_id, i.target_agent_id].includes(actor.agentId),
        )
      : [],
    activity: actor
      ? s.activityLogs.filter((l) => l.agent_id === actor.agentId).slice(0, 100)
      : [],
  };
}
