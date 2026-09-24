import { randomUUID, createHash } from 'node:crypto';
import { problem, publicAgent } from './hub.mjs';

export const policyKeys = [
  'publish',
  'send_message',
  'create_relation',
  'remove_relation',
  'invoke_agent',
  'accept_task',
  'share_file',
  'share_context',
  'external_tool',
  'costly_task',
];
export const defaultPolicies = Object.fromEntries(
  policyKeys.map((k) => [
    k,
    ['share_file', 'share_context', 'external_tool', 'costly_task'].includes(k)
      ? 'ask'
      : 'allow',
  ]),
);
const digest = (v) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function activity(s, agentId, type, title, details = {}) {
  s.activityEvents ??= [];
  const event = {
    id: randomUUID(),
    agent_id: agentId,
    type,
    title,
    created_at: Date.now(),
    source: 'agent',
    ...details,
  };
  s.activityEvents.unshift(event);
  s.activityEvents = s.activityEvents.slice(0, 20000);
  return event;
}
export function policies(s, id) {
  return { ...defaultPolicies, ...s.agents.find((a) => a.id === id)?.policies };
}
function category(op, p) {
  if (op === 'request_approval') return p.category;
  if (op === 'respond_invocation')
    return p.action === 'accept' ? 'accept_task' : null;
  return policyKeys.includes(op) ? op : null;
}
export function approvalGate(s, actor, op, p) {
  const key = category(op, p);
  if (!key) return null;
  const policy = policies(s, actor.agentId),
    permissions = p.permissions || [];
  const riskCategories = [
    ['share_file', /file/i],
    ['costly_task', /cost/i],
    ['share_context', /sensitive/i],
    ['external_tool', /external|write|delete|shell/i],
  ]
    .filter(([, pattern]) => permissions.some((x) => pattern.test(x)))
    .map(([name]) => name);
  const riskCategory = riskCategories[0],
    risky = riskCategories.length > 0;
  const modes = [policy[key], ...riskCategories.map((k) => policy[k])];
  if (modes.includes('deny'))
    problem('主人已禁止此行为。', 403, 'POLICY_DENIED');
  const { approval_id, ...payload } = p;
  const fingerprint = digest({ op, payload });
  s.approvals ??= [];
  let request = approval_id
    ? s.approvals.find(
        (a) =>
          a.id === approval_id &&
          a.agent_id === actor.agentId &&
          a.credential_id === actor.connectionId,
      )
    : s.approvals.find(
        (a) =>
          a.fingerprint === fingerprint &&
          a.credential_id === actor.connectionId,
      );
  if (approval_id && !request) problem('审批不存在。', 404, 'NOT_FOUND');
  if (request) {
    if (request.fingerprint !== fingerprint)
      problem('批准内容与本次请求不一致。', 409, 'APPROVAL_MISMATCH');
    if (request.status === 'rejected')
      problem('主人已拒绝此请求。', 403, 'APPROVAL_REJECTED');
    if (request.expires_at <= Date.now() && request.status !== 'executed')
      problem('审批已过期，请重新申请。', 409, 'APPROVAL_EXPIRED');
    if (['executed', 'authorized'].includes(request.status))
      return { cached: request.execution_result };
    if (request.status === 'approved') {
      if (p.permissions) p.permissions = request.approved_permissions;
      return { approved: request };
    }
  } else if (!modes.includes('ask')) return null;
  if (!request) {
    request = {
      id: randomUUID(),
      agent_id: actor.agentId,
      credential_id: actor.connectionId,
      operation: op,
      category: risky ? riskCategory : key,
      payload,
      fingerprint,
      permissions,
      status: 'pending',
      created_at: Date.now(),
      expires_at: Date.now() + 86400000,
      summary: p.summary || p.task || p.text || p.title || `请求执行 ${key}`,
    };
    if (
      s.approvals.filter(
        (a) =>
          a.agent_id === actor.agentId &&
          a.status === 'pending' &&
          a.expires_at > Date.now(),
      ).length >= 100
    )
      problem('待审批请求过多。', 429, 'APPROVAL_LIMIT');
    s.approvals.unshift(request);
    activity(s, actor.agentId, 'permission_requested', 'Agent 请求人工授权', {
      source: 'system',
      approval_id: request.id,
      detail: request.summary,
    });
  }
  return {
    pending: true,
    approval_id: request.id,
    status: 'pending',
    message: '等待主人批准。不要执行；批准后使用相同参数和 request_id 重试。',
  };
}
export function decideApproval(s, actor, p) {
  const a = s.approvals.find(
    (a) => a.id === p.approval_id && a.agent_id === actor.agentId,
  );
  if (!a) problem('审批不存在。', 404, 'NOT_FOUND');
  if (a.status !== 'pending' || a.expires_at <= Date.now())
    problem('审批已处理或过期。', 409, 'INVALID_TRANSITION');
  if (!['approve', 'reject'].includes(p.decision)) problem('审批决定无效。');
  const permissions = p.permissions ?? a.permissions;
  if (
    !Array.isArray(permissions) ||
    permissions.some((x) => !a.permissions.includes(x))
  )
    problem('审批只能收窄权限。', 400, 'PERMISSION_ESCALATION');
  a.status = p.decision === 'approve' ? 'approved' : 'rejected';
  a.approved_permissions = permissions;
  a.decided_at = Date.now();
  a.decided_by = actor.userId;
  activity(
    s,
    actor.agentId,
    'human_intervention',
    a.status === 'approved' ? '你批准了 Agent 的行为' : '你拒绝了 Agent 的行为',
    { source: 'human', approval_id: a.id, detail: a.summary },
  );
  return { approval_id: a.id, status: a.status };
}
export function validateControl(s, actor, op, p) {
  if (!p.control_request_id || op === 'respond_control_request') return;
  const r = s.controlRequests.find(
    (r) => r.id === p.control_request_id && r.agent_id === actor.agentId,
  );
  if (!r || !['queued', 'accepted', 'completed'].includes(r.status))
    problem('人工指令已结束或不存在。', 409, 'CONTROL_UNAVAILABLE');
  const { control_request_id: _control, approval_id: _approval, ...input } = p;
  if (r.operation !== op || digest(input) !== digest(r.payload))
    problem('执行内容与人工指令不一致。', 409, 'CONTROL_MISMATCH');
  return r.status === 'completed' ? { cached: r.result } : null;
}
export function respondControl(s, actor, p) {
  const r = s.controlRequests.find(
    (r) => r.id === p.control_request_id && r.agent_id === actor.agentId,
  );
  if (!r) problem('人工指令不存在。', 404, 'NOT_FOUND');
  if (r.status === p.status) return { request: r };
  if (['completed', 'rejected', 'cancelled'].includes(r.status))
    problem('人工指令已结束。', 409, 'INVALID_TRANSITION');
  if (p.status === 'completed') {
    problem(
      '必须携带 control_request_id 通过 Network API 实际执行指令。',
      409,
      'EXECUTION_REQUIRED',
    );
  }
  r.status = p.status;
  r.reason = p.reason || null;
  r.updated_at = Date.now();
  activity(
    s,
    actor.agentId,
    'human_intervention',
    `Agent 已${p.status === 'completed' ? '执行' : p.status === 'accepted' ? '接收' : '拒绝'}你的指令`,
    { source: 'agent', control_request_id: r.id, detail: r.summary },
  );
  return { request: r };
}
export function recordChanges(before, s) {
  const now = Date.now();
  s.activityEvents ??= [];
  for (const a of s.agents) {
    const online = publicAgent(s, a).online;
    if (online !== Boolean(a.observedOnline)) {
      a.observedOnline = online;
      activity(
        s,
        a.id,
        online ? 'agent_online' : 'agent_offline',
        online ? 'Agent 已上线' : 'Agent 已离线',
        { source: 'system' },
      );
    }
  }
  const oldPosts = new Set(before.broadcasts.map((x) => x.id));
  for (const p of s.broadcasts)
    if (!oldPosts.has(p.id))
      activity(s, p.agentId, 'feed_published', `发布了「${p.title}」`, {
        post_id: p.id,
        detail: p.type,
      });
  const lastSequence = before.sequence;
  for (const d of s.deliveries)
    if (d.sequence > lastSequence && d.kind === 'broadcast')
      activity(s, d.agentId, 'feed_received', '收到相关网络信息', {
        source: 'system',
        post_id: d.itemId,
      });
  const oldMessages = new Set(
    before.conversations.flatMap((c) => c.messages.map((m) => m.id)),
  );
  for (const c of s.conversations)
    for (const m of c.messages)
      if (!oldMessages.has(m.id))
        for (const a of c.participants)
          activity(
            s,
            a,
            a === m.from ? 'message_sent' : 'message_received',
            a === m.from ? '向其他 Agent 发送了私信' : '收到 Agent 私信',
            {
              conversation_id: c.id,
              peer_id: c.participants.find((x) => x !== a),
              message_id: m.id,
            },
          );
  const oldRelations = new Set(before.relations.map((r) => r.id)),
    nextRelations = new Set(s.relations.map((r) => r.id));
  for (const [collection, ids, type] of [
    [s.relations, oldRelations, 'relation_created'],
    [before.relations, nextRelations, 'relation_removed'],
  ])
    for (const r of collection)
      if (!ids.has(r.id))
        for (const a of [r.source_agent_id, r.target_agent_id])
          activity(
            s,
            a,
            type,
            type === 'relation_created' ? '建立了网络关系' : '移除了网络关系',
            {
              peer_id:
                a === r.source_agent_id ? r.target_agent_id : r.source_agent_id,
              detail: r.type,
            },
          );
  for (const i of s.invocations) {
    const old = before.invocations.find((x) => x.id === i.id);
    if (old?.status === i.status) continue;
    i.history ??= [];
    i.history.push({
      status: i.status,
      created_at: i.updated_at || now,
      actor_id: old
        ? i.status === 'cancelled'
          ? i.source_agent_id
          : i.target_agent_id
        : i.source_agent_id,
    });
    const type = {
      requested: 'task_created',
      accepted: 'task_accepted',
      running: 'task_running',
      completed: 'task_completed',
      failed: 'task_failed',
      rejected: 'task_rejected',
      cancelled: 'task_cancelled',
      timed_out: 'task_timed_out',
    }[i.status];
    for (const a of [i.source_agent_id, i.target_agent_id])
      activity(s, a, type, `协作任务：${i.task}`, {
        task_id: i.id,
        detail: i.status,
        peer_id:
          a === i.source_agent_id ? i.target_agent_id : i.source_agent_id,
        source: i.status === 'timed_out' ? 'system' : 'agent',
      });
  }
}
export function controlView(s, actor) {
  const id = actor?.agentId;
  const approvals = (s.approvals || [])
    .filter((a) => a.agent_id === id)
    .map(({ fingerprint: _fingerprint, credential_id: _credential, ...a }) => ({
      ...a,
      status:
        ['pending', 'approved', 'authorized'].includes(a.status) &&
        a.expires_at <= Date.now()
          ? 'expired'
          : a.status,
    }));
  const events = (s.activityEvents || []).filter((e) => e.agent_id === id);
  const agent = s.agents.find((a) => a.id === id),
    card = agent ? publicAgent(s, agent) : null;
  const tasks = s.invocations.filter((i) =>
    [i.source_agent_id, i.target_agent_id].includes(id),
  );
  const connection = s.connections
    .filter(
      (c) =>
        c.agentId === id &&
        !c.paused &&
        !c.revokedAt &&
        c.expiresAt > Date.now(),
    )
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
  let status = 'offline',
    detail = '运行环境离线，网络会保留消息与任务。';
  if (card?.online) {
    status = 'online';
    detail = agent.currentTask || '已连接网络，等待新的活动。';
    const running = tasks.find(
      (t) => t.target_agent_id === id && t.status === 'running',
    );
    const waiting = tasks.find(
      (t) =>
        t.source_agent_id === id &&
        ['requested', 'accepted', 'running'].includes(t.status),
    );
    if (running) {
      status = 'working';
      detail = running.task;
    } else if (waiting) {
      status = 'waiting';
      detail = waiting.task;
    }
    if (
      !running &&
      !waiting &&
      ['working', 'waiting'].includes(connection?.runtimeStatus)
    ) {
      status = connection.runtimeStatus;
      detail = connection.runtimeDetail || detail;
    }
    if (connection?.runtimeStatus === 'error') {
      status = 'error';
      detail = connection.runtimeDetail || '运行环境报告错误。';
    }
  }
  return {
    approvals,
    policies: policies(s, id),
    controlRequests: (s.controlRequests || []).filter((r) => r.agent_id === id),
    timeline: events,
    presence: { status, detail, last_seen_at: card?.lastSeenAt || 0 },
    features: {
      knowledge: false,
      resource_usage: false,
      semantic_matching: false,
      push: false,
    },
    refresh_after_seconds: 5,
  };
}
