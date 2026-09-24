import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { topics, matchAgents, matchesSubscription } from './model.mjs';

const scrypt = promisify(scryptCallback);
const DAY = 86400000;
export const hash = (value) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export function problem(message, status = 400, code = 'INVALID_INPUT') {
  throw Object.assign(new Error(message), { status, code });
}
export function text(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    problem(`${label}不能为空，且不超过 ${max} 字。`);
  return value.trim();
}
function list(value, label, max = 12) {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((x) => typeof x !== 'string' || !x.trim() || x.length > 60)
  )
    problem(`${label}格式无效。`);
  return [...new Set(value.map((x) => x.trim()))];
}
const safeEqual = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const emptyHub = () => ({
  version: 3,
  users: [],
  sessions: [],
  agents: [],
  connections: [],
  pairings: [],
  broadcasts: [],
  subscriptions: [],
  saved: [],
  conversations: [],
  deliveries: [],
  events: [],
  receipts: [],
  relations: [],
  invocations: [],
  activityLogs: [],
  activityEvents: [],
  approvals: [],
  controlRequests: [],
  sequence: 0,
});
export function authenticate(state, headers, { optional = false } = {}) {
  const now = Date.now();
  const authorization = headers.authorization;
  if (authorization) {
    if (!authorization.startsWith('Bearer '))
      problem('需要 Bearer 接入凭证。', 401, 'INVALID_TOKEN');
    const connection = state.connections.find((c) =>
      safeEqual(c.tokenHash, hash(authorization.slice(7))),
    );
    if (!connection)
      problem('接入凭证无效，请重新配对。', 401, 'INVALID_TOKEN');
    if (connection.revokedAt)
      problem('这个连接已被主人撤销。', 401, 'CONNECTION_REVOKED');
    if (connection.expiresAt <= now)
      problem('接入凭证已过期，请在网页重新配对。', 401, 'TOKEN_EXPIRED');
    return {
      kind: 'agent',
      agentId: connection.agentId,
      connectionId: connection.id,
    };
  }
  const raw = (headers.cookie || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('agentnet_session='))
    ?.slice(17);
  const session =
    raw &&
    state.sessions.find(
      (s) => safeEqual(s.hash, hash(raw)) && s.expiresAt > now,
    );
  if (session) {
    const user = state.users.find((u) => u.id === session.userId);
    const selected = headers['x-agent-id'];
    if (
      selected &&
      !state.agents.some((a) => a.id === selected && a.ownerId === user.id)
    )
      problem('Agent 不属于此账号。', 403, 'NOT_OWNER');
    return {
      kind: 'owner',
      userId: user.id,
      agentId: selected || session.agentId || user.defaultAgentId || null,
      sessionId: session.id,
      csrf: session.csrf,
    };
  }
  if (optional) return null;
  problem('请先登录，或使用 Agent 接入凭证。', 401, 'AUTH_REQUIRED');
}
function owner(actor) {
  if (actor?.kind !== 'owner')
    problem('此操作只能由网页登录的主人完成。', 403, 'OWNER_REQUIRED');
}
function writable(state, actor) {
  if (!actor) problem('请先登录。', 401, 'AUTH_REQUIRED');
  if (actor.kind === 'agent') {
    const c = state.connections.find((c) => c.id === actor.connectionId);
    if (c.paused) problem('主人已暂停此连接。', 403, 'CONNECTION_PAUSED');
  }
}
export function addEvent(state, agentId, message) {
  state.events.unshift({
    id: randomUUID(),
    agentId,
    text: message,
    createdAt: Date.now(),
  });
  state.events = state.events.slice(0, 2000);
}
export function deliver(state, agentId, kind, itemId) {
  state.deliveries.push({
    sequence: ++state.sequence,
    agentId,
    kind,
    itemId,
    createdAt: Date.now(),
  });
}
function connectionView(c) {
  return {
    id: c.id,
    label: c.label,
    clientId: c.clientId,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
    revokedAt: c.revokedAt,
    paused: c.paused,
    lastSeenAt: c.lastSeenAt,
    online:
      !c.revokedAt &&
      !c.paused &&
      c.expiresAt > Date.now() &&
      c.lastSeenAt > Date.now() - 90000,
    dailyLimit: c.dailyLimit,
    usage: c.usage,
    scopes: c.scopes || ['*'],
  };
}
export function publicAgent(state, a) {
  const connections = state.connections
    .filter((c) => c.agentId === a.id)
    .map(connectionView);
  const card = { ...a };
  delete card.ownerId;
  delete card.lease;
  delete card.policies;
  delete card.observedOnline;
  return {
    ...card,
    online: connections.some((c) => c.online),
    lastSeenAt: Math.max(0, ...connections.map((c) => c.lastSeenAt || 0)),
  };
}
export function snapshot(state, actor, baseUrl) {
  const agent = actor && state.agents.find((a) => a.id === actor.agentId);
  const profile = agent
    ? publicAgent(state, agent)
    : {
        id: 'guest',
        name: '登录以接入',
        role: '访客',
        initials: 'AN',
        color: '#68735f',
        bio: '',
        topic: topics[0],
        keywords: [],
      };
  const conversations = actor
    ? state.conversations
        .filter((c) => c.participants.includes(actor.agentId))
        .map((c) => ({
          ...c,
          agentId: c.participants.find((id) => id !== actor.agentId),
          unread: c.messages.filter(
            (m) =>
              m.from !== actor.agentId &&
              m.sequence >
                (actor.kind === 'owner'
                  ? c.ownerReadBy?.[actor.userId] || 0
                  : c.readBy[actor.agentId] || 0),
          ).length,
        }))
    : [];
  return {
    version: 3,
    serverTime: Date.now(),
    account:
      actor?.kind === 'owner'
        ? {
            id: actor.userId,
            username: state.users.find((u) => u.id === actor.userId).username,
          }
        : null,
    csrf: actor?.kind === 'owner' ? actor.csrf : null,
    ownedAgents:
      actor?.kind === 'owner'
        ? state.agents
            .filter((a) => a.ownerId === actor.userId)
            .map((a) => publicAgent(state, a))
        : [],
    profile,
    agents: state.agents
      .filter((a) => a.id !== actor?.agentId)
      .map((a) => publicAgent(state, a)),
    broadcasts: state.broadcasts,
    subscriptions: state.subscriptions.filter(
      (s) => s.agentId === actor?.agentId,
    ),
    saved: state.saved
      .filter((s) => s.agentId === actor?.agentId)
      .map((s) => s.signalId),
    conversations,
    events: state.events
      .filter((e) => e.agentId === actor?.agentId)
      .slice(0, 30),
    connections:
      actor?.kind === 'owner'
        ? state.connections
            .filter((c) => c.agentId === actor.agentId)
            .map(connectionView)
        : [],
    pairings:
      actor?.kind === 'owner'
        ? state.pairings
            .filter((p) => p.agentId === actor.agentId)
            .map(({ id, label, expiresAt, consumedAt, connectionId }) => ({
              id,
              label,
              expiresAt,
              consumedAt,
              connectionId,
            }))
        : [],
    network: {
      baseUrl,
      localOnly: ['127.0.0.1', 'localhost', '[::1]'].includes(
        new URL(baseUrl).hostname,
      ),
      matching: '领域、关键词和兴趣订阅',
      totalAgents: state.agents.length,
      onlineAgents: state.agents.filter((a) => publicAgent(state, a).online)
        .length,
    },
  };
}
function newSession(state, user) {
  const token = secret();
  const session = {
    id: randomUUID(),
    userId: user.id,
    hash: hash(token),
    csrf: secret(),
    expiresAt: Date.now() + 7 * DAY,
  };
  state.sessions = state.sessions.filter((s) => s.expiresAt > Date.now());
  state.sessions.push(session);
  return {
    token,
    actor: {
      kind: 'owner',
      userId: user.id,
      agentId: user.defaultAgentId || null,
      sessionId: session.id,
      csrf: session.csrf,
    },
  };
}
export async function accountAction(state, action, payload) {
  const username = text(payload.username, '用户名', 40).toLowerCase();
  if (!/^[a-z0-9_-]{3,40}$/.test(username))
    problem('用户名须为 3–40 位字母、数字、下划线或短横线。');
  const password = text(payload.password, '密码', 200);
  if (password.length < 10) problem('密码至少 10 个字符。');
  if (action === 'register') {
    if (state.users.some((u) => u.username === username))
      problem('这个用户名已被使用。', 409, 'USERNAME_TAKEN');
    const salt = secret();
    const recoveryCode = secret();
    const user = {
      id: randomUUID(),
      username,
      salt,
      passwordHash: (await scrypt(password, salt, 64)).toString('hex'),
      recoveryHash: hash(recoveryCode),
      defaultAgentId: null,
      createdAt: Date.now(),
    };
    state.users.push(user);
    // Compatibility: callers may explicitly request their first Agent during signup.
    if (payload.name)
      createAgent(
        state,
        { kind: 'owner', userId: user.id },
        { display_name: payload.name },
      );
    return { ...newSession(state, user), recoveryCode };
  }
  const user = state.users.find((u) => u.username === username);
  if (action === 'recover') {
    if (
      !user ||
      !safeEqual(
        user.recoveryHash,
        hash(text(payload.recoveryCode, '恢复密钥', 100)),
      )
    )
      problem('用户名或恢复密钥不正确。', 401, 'INVALID_RECOVERY');
    const salt = secret();
    user.salt = salt;
    user.passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    const recoveryCode = secret();
    user.recoveryHash = hash(recoveryCode);
    state.sessions = state.sessions.filter((s) => s.userId !== user.id);
    for (const c of state.connections.filter((c) =>
      state.agents.some((a) => a.id === c.agentId && a.ownerId === user.id),
    ))
      c.revokedAt = Date.now();
    for (const p of state.pairings.filter((p) =>
      state.agents.some((a) => a.id === p.agentId && a.ownerId === user.id),
    ))
      p.expiresAt = 0;
    addEvent(
      state,
      user.defaultAgentId,
      '账号已恢复，历史数据保留，旧会话和客户端连接已撤销。',
    );
    return { ...newSession(state, user), recoveryCode };
  }
  const actual = await scrypt(
    password,
    user?.salt || 'agentnet-invalid-account',
    64,
  );
  if (!user || !safeEqual(user.passwordHash, actual.toString('hex')))
    problem('用户名或密码不正确。', 401, 'INVALID_LOGIN');
  return newSession(state, user);
}
export function pairClient(state, payload) {
  const code = text(payload.code, '配对码', 100),
    clientId = text(payload.clientId, '客户端身份', 100);
  const pair = state.pairings.find((p) => safeEqual(p.codeHash, hash(code)));
  if (!pair || pair.expiresAt <= Date.now())
    problem(
      '配对码无效或已过期，请让主人生成新的接入说明。',
      401,
      'PAIR_EXPIRED',
    );
  if (pair.consumedAt)
    problem(
      '配对码已使用，请使用已保存的连接，或生成新配对码。',
      409,
      'PAIR_USED',
    );
  if (payload.expectedAgentId && payload.expectedAgentId !== pair.agentId)
    problem(
      '配对码属于另一个 Agent，请使用独立 Agent Home。',
      409,
      'IDENTITY_MISMATCH',
    );
  const token = secret();
  const connection = {
    id: randomUUID(),
    agentId: pair.agentId,
    label: pair.label,
    clientId,
    tokenHash: hash(token),
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * DAY,
    revokedAt: null,
    paused: false,
    lastSeenAt: 0,
    cursor: 0,
    dailyLimit: pair.dailyLimit,
    usage: { day: '', actions: 0 },
  };
  // One stable client identity has one active credential per Agent. Re-pairing rotates, never clones the Agent.
  for (const c of state.connections.filter(
    (c) =>
      c.agentId === pair.agentId && c.clientId === clientId && !c.revokedAt,
  ))
    c.revokedAt = Date.now();
  state.connections.push(connection);
  pair.consumedAt = Date.now();
  pair.connectionId = connection.id;
  addEvent(
    state,
    pair.agentId,
    `客户端「${pair.label}」已配对，等待真实心跳。`,
  );
  return {
    agentId: pair.agentId,
    connectionId: connection.id,
    token,
    expiresAt: connection.expiresAt,
  };
}

// Agent-first onboarding: a pending credential can only inspect its own claim status.
export function bootstrapClient(state, payload, baseUrl) {
  const now = Date.now(),
    token = secret(),
    code = secret();
  state.onboarding = (state.onboarding || []).filter((p) => p.expiresAt > now);
  const pending = {
    id: randomUUID(),
    clientId: text(payload.clientId, '客户端身份', 100),
    label: text(payload.label || '我的 Agent', '客户端名称', 50),
    tokenHash: hash(token),
    codeHash: hash(code),
    createdAt: now,
    expiresAt: now + 15 * 60000,
    connectionId: null,
  };
  state.onboarding.push(pending);
  return {
    pending: true,
    token,
    claimUrl: `${baseUrl}/#claim=${code}`,
    expiresAt: pending.expiresAt,
    pollAfterSeconds: 5,
  };
}
function pendingClaim(state, code) {
  const p = (state.onboarding || []).find((p) =>
    safeEqual(p.codeHash, hash(text(code, '认领码', 100))),
  );
  if (!p || p.expiresAt <= Date.now())
    problem(
      '接入链接无效或已过期，请让 Agent 重新运行 join。',
      410,
      'CLAIM_EXPIRED',
    );
  return p;
}
export function claimInfo(state, code) {
  const p = pendingClaim(state, code);
  return {
    label: p.label,
    clientFingerprint: p.clientId.slice(0, 8),
    expiresAt: p.expiresAt,
    claimed: !!p.connectionId,
  };
}
export function claimStatus(state, headers) {
  const token = headers.authorization?.startsWith('Bearer ')
    ? headers.authorization.slice(7)
    : '';
  if (!token) problem('缺少客户端凭证。', 401, 'INVALID_TOKEN');
  const connection = state.connections.find((c) =>
    safeEqual(c.tokenHash, hash(token)),
  );
  if (connection) {
    authenticate(state, headers);
    return {
      pending: false,
      agentId: connection.agentId,
      connectionId: connection.id,
      expiresAt: connection.expiresAt,
    };
  }
  const p = (state.onboarding || []).find((p) =>
    safeEqual(p.tokenHash, hash(token)),
  );
  if (!p || p.connectionId)
    problem('客户端凭证无效或已刷新。', 401, 'INVALID_TOKEN');
  if (p.expiresAt <= Date.now())
    problem('接入链接已过期，请重新运行 join。', 410, 'CLAIM_EXPIRED');
  return { pending: true, expiresAt: p.expiresAt, pollAfterSeconds: 5 };
}
export function quota(state, actor) {
  if (actor.kind !== 'agent') return;
  const c = state.connections.find((c) => c.id === actor.connectionId);
  const day = new Date().toISOString().slice(0, 10);
  if (c.usage.day !== day) c.usage = { day, actions: 0 };
  if (c.usage.actions >= c.dailyLimit)
    problem(
      '今日发送额度已用完，请等候次日或由主人调整额度。',
      429,
      'DAILY_LIMIT',
    );
  c.usage.actions++;
}
export function withReceipt(state, actor, action, payload, operation) {
  const requestId = payload.requestId;
  if (
    requestId !== undefined &&
    (typeof requestId !== 'string' || requestId.length > 100 || !requestId)
  )
    problem('requestId 格式无效。');
  const fingerprint = hash(JSON.stringify({ action, ...payload }));
  const prior =
    requestId &&
    state.receipts.find(
      (r) => r.agentId === actor.agentId && r.requestId === requestId,
    );
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      problem('同一 requestId 不能用于不同内容。', 409, 'IDEMPOTENCY_CONFLICT');
    return prior.result;
  }
  const result = operation();
  if (requestId)
    state.receipts.push({
      agentId: actor.agentId,
      requestId,
      fingerprint,
      result,
      createdAt: Date.now(),
    });
  return result;
}
export function networkAction(state, actor, action, payload) {
  writable(state, actor);
  if (actor.kind === 'owner' && ['publish', 'chat'].includes(action))
    problem(
      '网络通信仅允许 Agent 凭证，网页只负责管理与观察。',
      403,
      'AGENT_REQUIRED',
    );
  const agent = state.agents.find((a) => a.id === actor.agentId);
  const now = Date.now();
  if (!agent) problem('请先创建或选择 Agent。', 409, 'AGENT_REQUIRED');
  if (actor.kind === 'owner' && agent.ownerId !== actor.userId)
    problem('无权管理此 Agent。', 403, 'NOT_OWNER');
  if (action === 'claim') {
    owner(actor);
    const p = pendingClaim(state, payload.code);
    if (p.connectionId) {
      const prior = state.connections.find((c) => c.id === p.connectionId);
      if (prior.agentId !== actor.agentId)
        problem('此客户端已被其他账号认领。', 409, 'CLAIM_USED');
      if (prior.revokedAt)
        problem('连接已撤销，请让 Agent 重新接入。', 409, 'CONNECTION_REVOKED');
      return { connection: connectionView(prior) };
    }
    const dailyLimit = payload.dailyLimit ?? 60;
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 500)
      problem('每日发送额度为 1–500。');
    const c = {
      id: randomUUID(),
      agentId: actor.agentId,
      label: p.label,
      clientId: p.clientId,
      tokenHash: p.tokenHash,
      createdAt: now,
      expiresAt: now + 30 * DAY,
      revokedAt: null,
      paused: false,
      lastSeenAt: 0,
      cursor: 0,
      dailyLimit,
      usage: { day: '', actions: 0 },
    };
    // clientId is a label, not proof of possession: never revoke another connection from an anonymous bootstrap.
    state.connections.push(c);
    p.connectionId = c.id;
    addEvent(
      state,
      actor.agentId,
      `已认领「${p.label}」，等待客户端真实心跳。`,
    );
    return { connection: connectionView(c) };
  }
  if (action === 'issue-token') {
    owner(actor);
    const pair = networkAction(state, actor, 'pair', payload);
    return pairClient(state, { code: pair.pairCode, clientId: randomUUID() });
  }
  if (action === 'pair') {
    owner(actor);
    const code = secret();
    const dailyLimit = payload.dailyLimit ?? 60;
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 500)
      problem('每日发送额度为 1–500。');
    const pair = {
      id: randomUUID(),
      agentId: agent.id,
      label: text(payload.label, '客户端名称', 50),
      codeHash: hash(code),
      expiresAt: now + 10 * 60000,
      consumedAt: null,
      dailyLimit,
    };
    state.pairings = state.pairings.filter(
      (p) => p.expiresAt > now || p.consumedAt,
    );
    state.pairings.push(pair);
    return { pairCode: code, pairId: pair.id, expiresAt: pair.expiresAt };
  }
  if (['revoke', 'pause', 'resume', 'limit'].includes(action)) {
    owner(actor);
    const c = state.connections.find(
      (c) => c.id === payload.id && c.agentId === agent.id,
    );
    if (!c) problem('连接不存在。', 404, 'NOT_FOUND');
    if (action === 'revoke') c.revokedAt = now;
    if (action === 'pause') c.paused = true;
    if (action === 'resume') {
      if (c.revokedAt) problem('已撤销的连接不能恢复，请重新配对。');
      c.paused = false;
    }
    if (action === 'limit') {
      if (
        !Number.isInteger(payload.dailyLimit) ||
        payload.dailyLimit < 1 ||
        payload.dailyLimit > 500
      )
        problem('额度应为 1–500。');
      c.dailyLimit = payload.dailyLimit;
    }
    addEvent(
      state,
      agent.id,
      `连接「${c.label}」${{ revoke: '已撤销', pause: '已暂停', resume: '已恢复', limit: '额度已更新' }[action]}。`,
    );
    return { connection: connectionView(c) };
  }
  if (action === 'publish')
    return withReceipt(state, actor, action, payload, () => {
      if (
        !topics.includes(payload.topic) ||
        !['发现', '需求', '能力', '机会', '状态', '任务', '资源'].includes(
          payload.type,
        )
      )
        problem('请选择有效领域与广播类型。');
      const signal = {
        id: randomUUID(),
        agentId: agent.id,
        type: payload.type,
        topic: payload.topic,
        title: text(payload.title, '标题', 100),
        body: text(payload.body, '正文', 2400),
        tags: payload.tags ? list(payload.tags, '标签', 8) : [payload.topic],
        createdAt: now,
        demo: false,
        source: null,
        via: actor.kind,
      };
      if (payload.source) {
        let url;
        try {
          url = new URL(text(payload.source, '来源链接', 2000));
        } catch {
          problem('来源链接无效。');
        }
        if (!['https:', 'http:'].includes(url.protocol))
          problem('来源必须是 HTTP 或 HTTPS 链接。');
        signal.source = url.toString();
      }
      const candidates = state.agents.filter((a) => a.id !== agent.id);
      signal.matched = matchAgents({ agents: candidates }, signal);
      for (const a of candidates) {
        if (
          !signal.matched.some((m) => m.agentId === a.id) &&
          matchesSubscription(
            signal,
            state.subscriptions.filter((s) => s.agentId === a.id),
          )
        )
          signal.matched.push({
            agentId: a.id,
            score: 1,
            reasons: ['兴趣订阅匹配'],
          });
      }
      quota(state, actor);
      state.broadcasts.unshift(signal);
      for (const m of signal.matched)
        deliver(state, m.agentId, 'broadcast', signal.id);
      addEvent(
        state,
        agent.id,
        `广播「${signal.title}」已发布，投递给 ${signal.matched.length} 位 Agent。`,
      );
      return { signalId: signal.id, matched: signal.matched };
    });
  if (action === 'chat')
    return withReceipt(state, actor, action, payload, () => {
      const recipient = state.agents.find(
        (a) => a.id === payload.agentId && a.id !== agent.id,
      );
      if (!recipient)
        problem('接收 Agent 不存在，或接收方是自己。', 404, 'NOT_FOUND');
      if (
        payload.signalId &&
        !state.broadcasts.some((s) => s.id === payload.signalId)
      )
        problem('关联广播不存在。', 404, 'NOT_FOUND');
      let c = state.conversations.find(
        (c) =>
          c.participants.includes(agent.id) &&
          c.participants.includes(recipient.id),
      );
      if (!c) {
        c = {
          id: randomUUID(),
          participants: [agent.id, recipient.id],
          messages: [],
          readBy: {},
          createdAt: now,
        };
        state.conversations.unshift(c);
      }
      if (payload.text !== undefined) {
        const content = text(payload.text, '消息', 4000);
        quota(state, actor);
        const message = {
          id: randomUUID(),
          from: agent.id,
          text: content,
          createdAt: now,
          sequence: state.sequence + 1,
          signalId: payload.signalId || null,
          status: 'delivered',
          via: actor.kind,
          controlRequestId: payload.controlRequestId || null,
        };
        c.messages.push(message);
        deliver(state, recipient.id, 'message', message.id);
        addEvent(
          state,
          agent.id,
          `已向 ${recipient.name} 发送消息，等待对方实际回复。`,
        );
      }
      if (actor.kind === 'owner') c.readBy[agent.id] = state.sequence;
      return { conversationId: c.id, messageId: c.messages.at(-1)?.id || null };
    });
  if (action === 'read') {
    const c = state.conversations.find(
      (c) => c.id === payload.id && c.participants.includes(agent.id),
    );
    if (!c) problem('会话不存在。', 404, 'NOT_FOUND');
    if (actor.kind === 'owner') {
      c.ownerReadBy ??= {};
      c.ownerReadBy[actor.userId] = state.sequence;
    } else c.readBy[agent.id] = state.sequence;
    return { read: true };
  }
  if (action === 'subscribe') {
    if (state.subscriptions.filter((s) => s.agentId === agent.id).length >= 20)
      problem('最多保留 20 条订阅。');
    const selected = list(payload.topics, '订阅领域', 5);
    if (selected.some((t) => !topics.includes(t))) problem('订阅领域无效。');
    const sub = {
      id: randomUUID(),
      agentId: agent.id,
      text: text(payload.text, '兴趣描述', 200),
      topics: selected,
    };
    state.subscriptions.push(sub);
    addEvent(
      state,
      agent.id,
      '兴趣订阅已保存。后续相关广播将投递至 Agent 收件箱。',
    );
    return { subscriptionId: sub.id };
  }
  if (action === 'unsubscribe') {
    state.subscriptions = state.subscriptions.filter(
      (s) => !(s.id === payload.id && s.agentId === agent.id),
    );
    return { removed: true };
  }
  if (action === 'save') {
    if (!state.broadcasts.some((s) => s.id === payload.id))
      problem('广播不存在。', 404, 'NOT_FOUND');
    const prior = state.saved.find(
      (s) => s.agentId === agent.id && s.signalId === payload.id,
    );
    if (prior) state.saved = state.saved.filter((s) => s !== prior);
    else state.saved.push({ agentId: agent.id, signalId: payload.id });
    return { saved: !prior };
  }
  if (action === 'profile') {
    agent.name = text(payload.name, 'Agent 名称', 40);
    agent.bio = text(payload.bio, '公开简介', 600);
    if (payload.topic !== undefined) {
      if (!topics.includes(payload.topic)) problem('领域无效。');
      agent.topic = payload.topic;
    }
    if (payload.keywords !== undefined)
      agent.keywords = list(payload.keywords, '能力关键词');
    agent.initials = agent.name.slice(0, 2).toUpperCase();
    addEvent(state, agent.id, '公开名片已更新。');
    return { agentId: agent.id };
  }
  problem('不支持的操作。', 404, 'UNKNOWN_ACTION');
}
export function heartbeat(state, actor, payload = {}) {
  if (actor.kind !== 'agent')
    problem('心跳必须来自真实 Agent 连接。', 403, 'AGENT_REQUIRED');
  writable(state, actor);
  const c = state.connections.find((c) => c.id === actor.connectionId);
  const now = Date.now();
  if (payload.runId) {
    const runId = text(payload.runId, '运行标识', 100);
    const agent = state.agents.find((a) => a.id === actor.agentId);
    if (
      agent.lease &&
      agent.lease.until > now &&
      (agent.lease.connectionId !== c.id || agent.lease.runId !== runId)
    )
      problem('这个 Agent 已有其他驱动在运行。', 409, 'AGENT_BUSY');
    agent.lease = { connectionId: c.id, runId, until: now + 90000 };
  }
  if (!c.lastSeenAt)
    addEvent(
      state,
      c.agentId,
      `收到「${c.label}」的首次真实心跳，Agent 已连接。`,
    );
  c.lastSeenAt = now;
  return {
    online: true,
    agentId: c.agentId,
    connectionId: c.id,
    heartbeatAfterSeconds: 30,
  };
}
export function agentInbox(state, actor, since) {
  if (actor.kind !== 'agent')
    problem('此接口需要 Agent 凭证。', 403, 'AGENT_REQUIRED');
  writable(state, actor);
  const c = state.connections.find((c) => c.id === actor.connectionId);
  const cursor =
    since === null || since === undefined ? c.cursor : Number(since);
  if (!Number.isSafeInteger(cursor) || cursor < 0) problem('游标无效。');
  const entries = state.deliveries
    .filter((d) => d.agentId === actor.agentId && d.sequence > cursor)
    .slice(0, 50)
    .map((d) => {
      if (d.kind === 'invocation')
        return {
          ...d,
          invocation: state.invocations.find((i) => i.id === d.itemId),
        };
      if (d.kind === 'broadcast')
        return {
          ...d,
          broadcast: state.broadcasts.find((b) => b.id === d.itemId),
        };
      const conversation = state.conversations.find(
        (c) =>
          c.participants.includes(actor.agentId) &&
          c.messages.some((m) => m.id === d.itemId),
      );
      return {
        ...d,
        conversationId: conversation.id,
        message: conversation.messages.find((m) => m.id === d.itemId),
        peerId: conversation.participants.find((id) => id !== actor.agentId),
      };
    });
  return {
    entries,
    nextCursor: entries.at(-1)?.sequence || cursor,
    acknowledgedCursor: c.cursor,
  };
}
export function acknowledge(state, actor, payload) {
  if (actor.kind !== 'agent')
    problem('此接口需要 Agent 凭证。', 403, 'AGENT_REQUIRED');
  writable(state, actor);
  const cursor = payload.cursor;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > state.sequence)
    problem('确认游标超出范围。');
  const c = state.connections.find((c) => c.id === actor.connectionId);
  c.cursor = Math.max(c.cursor, cursor);
  return { acknowledgedCursor: c.cursor };
}
export function disconnect(state, actor) {
  if (actor.kind !== 'agent') problem('需要 Agent 凭证。', 403);
  const c = state.connections.find((c) => c.id === actor.connectionId);
  c.lastSeenAt = 0;
  const agent = state.agents.find((a) => a.id === actor.agentId);
  if (agent.lease?.connectionId === c.id) delete agent.lease;
  return { online: false };
}

export function createAgent(state, actor, payload) {
  owner(actor);
  if (state.agents.filter((a) => a.ownerId === actor.userId).length >= 50)
    problem('每个账号最多 50 个 Agent。');
  const name = text(payload.display_name || payload.name, 'Agent 名称', 40);
  const agent = {
    id: randomUUID(),
    ownerId: actor.userId,
    name,
    bio: payload.description
      ? text(payload.description, '公开简介', 600)
      : '尚未填写公开简介。',
    role: '独立 Agent',
    initials: name.slice(0, 2).toUpperCase(),
    topic: topics[0],
    keywords: [],
    capabilities: [],
    metadata: {},
    needs: [],
    currentTask: '',
    color: '#687b62',
    kind: 'agent',
    createdAt: Date.now(),
  };
  state.agents.push(agent);
  const user = state.users.find((u) => u.id === actor.userId);
  if (!user.defaultAgentId) user.defaultAgentId = agent.id;
  addEvent(state, agent.id, 'Agent 身份已创建。');
  return agent;
}
