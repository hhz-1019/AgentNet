import { randomUUID, randomBytes } from 'node:crypto';
import {
  problem,
  withReceipt,
  quota,
  deliver,
  addEvent,
  hash,
} from './hub.mjs';
export const terminal = new Set([
  'completed',
  'rejected',
  'failed',
  'cancelled',
  'timed_out',
]);
export function expireInvocations(s, now = Date.now()) {
  for (const i of s.invocations)
    if (!terminal.has(i.status) && i.deadline_at <= now) {
      i.status = 'timed_out';
      i.updated_at = now;
      for (const a of [i.source_agent_id, i.target_agent_id]) {
        deliver(s, a, 'invocation', i.id);
        addEvent(s, a, '任务请求已超时。');
      }
    }
}
export function invocationAction(s, actor, op, p) {
  const me = actor.agentId,
    now = Date.now();
  return withReceipt(s, actor, op, { ...p, requestId: p.request_id }, () => {
    if (op === 'invoke_agent') {
      if (
        !s.agents.some((a) => a.id === p.target_agent_id) ||
        p.target_agent_id === me
      )
        problem('目标 Agent 不存在或是自己。', 404, 'NOT_FOUND');
      quota(s, actor);
      const i = {
        id: randomUUID(),
        source_agent_id: me,
        ...p,
        status: 'requested',
        accepted_permissions: [],
        result: null,
        created_at: now,
        updated_at: now,
        deadline_at: now + p.timeout_seconds * 1000,
      };
      s.invocations.unshift(i);
      deliver(s, i.target_agent_id, 'invocation', i.id);
      addEvent(s, me, '已发起任务请求。');
      return { invocation: i };
    }
    const i = s.invocations.find(
      (i) =>
        i.id === p.invocation_id &&
        [i.source_agent_id, i.target_agent_id].includes(me),
    );
    if (!i) problem('任务不存在。', 404, 'NOT_FOUND');
    if (terminal.has(i.status))
      problem('任务已结束。', 409, 'INVALID_TRANSITION');
    if (p.action === 'cancel') {
      if (i.source_agent_id !== me)
        problem('只有发起方可以取消。', 403, 'FORBIDDEN');
      i.status = 'cancelled';
    } else {
      if (i.target_agent_id !== me)
        problem('只有接收方可以执行此操作。', 403, 'FORBIDDEN');
      const transitions = {
        accept: ['requested', 'accepted'],
        reject: ['requested', 'rejected'],
        start: ['accepted', 'running'],
        complete: ['running', 'completed'],
        fail: ['running', 'failed'],
      };
      const [from, to] = transitions[p.action];
      if (i.status !== from)
        problem('任务状态不允许此转换。', 409, 'INVALID_TRANSITION');
      if (p.action === 'accept') {
        const permissions = p.permissions || [];
        if (permissions.some((x) => !i.permissions.includes(x)))
          problem('不能扩大任务请求的权限。', 403, 'PERMISSION_ESCALATION');
        i.accepted_permissions = permissions;
      }
      if (p.action === 'complete' && !p.result)
        problem('完成任务需要 result。');
      i.status = to;
      if (p.result) i.result = p.result;
    }
    i.reason = p.reason || null;
    i.updated_at = now;
    for (const a of [i.source_agent_id, i.target_agent_id]) {
      deliver(s, a, 'invocation', i.id);
      addEvent(s, a, `任务状态：${i.status}`);
    }
    return { invocation: i };
  });
}
export function relationAction(s, actor, op, p) {
  if (op === 'remove_relation') {
    const r = s.relations.find(
      (r) => r.id === p.relation_id && r.source_agent_id === actor.agentId,
    );
    if (!r) problem('关系不存在或无权移除。', 404, 'NOT_FOUND');
    s.relations = s.relations.filter((x) => x !== r);
    return { removed: true };
  }
  return withReceipt(s, actor, op, { ...p, requestId: p.request_id }, () => {
    if (
      p.target_agent_id === actor.agentId ||
      !s.agents.some((a) => a.id === p.target_agent_id)
    )
      problem('目标 Agent 无效。', 404, 'NOT_FOUND');
    if (p.type === 'custom' && !p.label) problem('自定义关系需要 label。');
    let r = s.relations.find(
      (r) =>
        r.source_agent_id === actor.agentId &&
        r.target_agent_id === p.target_agent_id &&
        r.type === p.type &&
        r.label === (p.label || null),
    );
    if (!r) {
      r = {
        id: randomUUID(),
        source_agent_id: actor.agentId,
        target_agent_id: p.target_agent_id,
        type: p.type,
        label: p.label || null,
        metadata: p.metadata,
        created_at: Date.now(),
      };
      s.relations.push(r);
    }
    return { relation: r };
  });
}
export function rotateCredential(s, actor) {
  const c = s.connections.find((c) => c.id === actor.connectionId),
    token = randomBytes(32).toString('base64url');
  c.tokenHash = hash(token);
  c.expiresAt = Date.now() + 30 * 86400000;
  return {
    agent_id: actor.agentId,
    credential_id: c.id,
    token,
    expires_at: c.expiresAt,
  };
}
