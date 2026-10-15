export type MomentAction = {
  action_key: string;
  kind: string;
  flag: string;
  appearance: string;
};
export type MomentItem = {
  attention_id: string;
  title: string;
  body: string;
  recommendation: string;
  category: string;
  status: string;
  response_status: string;
  item_revision: number;
  selected_action_key?: string;
  created_at: number;
  expires_at: number;
  source_ref?: { type?: string; id?: string };
  context_ref?: {
    moment?: {
      related_agent_id?: string;
      priority: number;
      executor_id: string;
      scopes: Record<string, string>;
    };
  };
  actions: MomentAction[];
  related_agent: { agent_id: string; name: string };
  command?: {
    command_id: string;
    delivery?: 'current_chat';
    context_ref?: { moment?: { executor_id: string } };
    status: string;
    condition?: string;
    authorization_scope?: string;
    selected_at: number;
    completed_at?: number;
    revoked_at?: number;
    result?: {
      summary?: string;
      execution?: {
        host_id: string;
        session_id: string;
        evidence: string;
        input_hash: string;
      };
      related_entities?: {
        type: string;
        id: string;
        label?: string;
        url?: string;
      }[];
    };
  };
};
export type MomentPage = {
  items: MomentItem[];
  next_cursor: string;
  server_time: number;
};
export function momentStage(item: MomentItem, now = Date.now()) {
  if (item.command?.status === 'completed') return 'completed';
  if (item.expires_at <= now || item.command?.status === 'expired')
    return 'expired';
  if (item.command?.revoked_at && item.status === 'dismissed') return 'revoked';
  if (item.status === 'dismissed') return 'deferred';
  if (item.command?.status === 'claimed') return 'executing';
  if (['pending', 'notified'].includes(item.command?.status || ''))
    return 'pending';
  if (item.command?.status === 'failed' && item.selected_action_key)
    return 'failed';
  return 'open';
}
export const momentLabels: Record<ReturnType<typeof momentStage>, string> = {
  open: '等你决定',
  pending: '确认已保存 · 等待执行',
  executing: 'Agent 正在执行',
  completed: 'Agent 已执行 · 收到结果',
  failed: '执行未完成',
  expired: '已过期',
  deferred: '暂时搁置',
  revoked: '已撤回',
};
export function hasMomentReceipt(item: MomentItem) {
  return Boolean(
    item.command &&
    ['completed', 'failed', 'expired'].includes(item.command.status) &&
    item.command.result?.summary?.trim(),
  );
}
const preset: Record<string, string> = {
  approve_first_contact: '允许首次联系',
  observe_first: '先观察',
  apply_goal_update: '更新近期重点',
  keep_goal: '保持当前目标',
  apply_intent_update: '接受意图更新',
  keep_intent: '保持当前意图',
  follow_up: '继续跟进',
  not_interested: '不感兴趣',
  open_source: '查看来源',
  ask_agent_contact: '帮我建立联系',
  add_watch: '加入观察重点',
  ask_agent_summarize: '总结影响',
  draft_broadcast: '整理广播草稿',
};
export function actionText(a: MomentAction) {
  return a.kind === 'preset' ? preset[a.flag] || a.flag : a.flag;
}
export function groupMoments(
  items: MomentItem[],
  ownID: string,
  now: number,
  messages: MomentMessage[] = [],
) {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      own: boolean;
      items: MomentItem[];
      messages: MomentMessage[];
      priority: number;
    }
  >();
  for (const item of items) {
    const id = item.related_agent.agent_id || ownID,
      own = id === ownID;
    const stage = momentStage(item, now);
    const bonus =
      stage === 'open'
        ? 30
        : stage === 'completed'
          ? 15
          : stage === 'pending' || stage === 'executing'
            ? 10
            : 0;
    const priority =
      Math.max(0, Math.min(100, item.context_ref?.moment?.priority ?? 40)) +
      bonus;
    const group = groups.get(id) || {
      id,
      name: own ? '你的 Agent' : item.related_agent.name || '关联 Agent',
      own,
      items: [],
      messages: [],
      priority,
    };
    group.items.push(item);
    group.priority = Math.max(group.priority, priority);
    groups.set(id, group);
  }
  for (const message of messages) {
    const id = message.agent_id;
    const priority = message.viewed_at ? 25 : 65;
    const group = groups.get(id) || {
      id,
      name: message.agent_name || '网络信息',
      own: id === ownID,
      items: [],
      messages: [],
      priority,
    };
    group.messages.push(message);
    group.priority = Math.max(group.priority, priority);
    groups.set(id, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );
}
import type { MomentMessage } from './moment-inbox';
