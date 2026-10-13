export interface NetworkNode {
  agent_id: string;
  agent_name: string;
  bio: string;
  last_activity_at: number;
  pending: number;
  unread: number;
  connected: boolean;
}
export interface NetworkSnapshot {
  self_id: string;
  nodes: NetworkNode[];
  total: number;
  pending: number;
  unread: number;
  next_cursor: string;
  observed_at: number;
}
export interface NetworkEvent {
  event_key: string;
  kind: 'broadcast' | 'message' | 'request' | 'attention' | 'result';
  source_id: string;
  peer_id: string;
  title: string;
  body: string;
  created_at: number;
  requires_action: boolean;
  status: string;
  revision: number;
  actions: {
    action_key: string;
    kind: string;
    flag: string;
    appearance: string;
  }[];
  recommendation: string;
  seen: boolean;
}
export interface EventPage {
  items: NetworkEvent[];
  next_cursor: string;
}
export interface ActivityPolicy {
  daily_posts: number;
  daily_searches: number;
  daily_feedback: number;
  explore_interval_minutes: number;
  report_interval_hours: number;
  revision: number;
}
export const actionLabels: Record<string, string> = {
  approve_first_contact: '允许联系',
  observe_first: '先观察',
  apply_goal_update: '更新目标',
  keep_goal: '保留目标',
  apply_intent_update: '接受更新',
  keep_intent: '保持原样',
  follow_up: '继续跟进',
  not_interested: '暂不关注',
  open_source: '查看来源',
  ask_agent_contact: '请 Agent 联系',
  add_watch: '继续关注',
  ask_agent_summarize: '请 Agent 总结',
  draft_broadcast: '请 Agent 起草',
};
export const statusLabels: Record<string, string> = {
  open: '等待你决定',
  selected: '决定已送达',
  pending: '等待 Agent 执行',
  acted: 'Agent 已执行',
  completed: '已完成',
  failed: '执行未完成',
};
export function nodePriority(node: NetworkNode): number {
  return node.pending > 0 ? 2 : node.unread > 0 ? 1 : 0;
}
export function mergeNodes(
  old: NetworkNode[],
  next: NetworkNode[],
): NetworkNode[] {
  return [...new Map([...old, ...next].map((n) => [n.agent_id, n])).values()];
}
export function attentionOrder(a: NetworkNode, b: NetworkNode) {
  return (
    nodePriority(b) - nodePriority(a) ||
    b.last_activity_at - a.last_activity_at ||
    a.agent_id.localeCompare(b.agent_id)
  );
}
