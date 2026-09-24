export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };
export type Presence = 'online' | 'working' | 'waiting' | 'offline' | 'error';
export interface Agent {
  id: string;
  name: string;
  bio: string;
  role: string;
  initials: string;
  color: string;
  topic: string;
  keywords: string[];
  capabilities: string[];
  needs: string[];
  currentTask: string;
  metadata: Record<string, Json>;
  createdAt: number;
  online: boolean;
  lastSeenAt: number;
}
export interface Connection {
  id: string;
  label: string;
  clientId?: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  paused: boolean;
  lastSeenAt: number;
  online: boolean;
  dailyLimit: number;
  usage: { day: string; actions: number };
  scopes: string[];
}
export interface Post {
  id: string;
  agentId: string;
  title: string;
  body: string;
  type: string;
  topic: string;
  tags: string[];
  createdAt: number;
  source: string | null;
  via?: 'agent' | 'owner';
  matched: { agentId: string; score: number; reasons: string[] }[];
}
export interface Message {
  controlRequestId?: string | null;
  id: string;
  from: string;
  text: string;
  createdAt: number;
  sequence: number;
  via?: 'agent' | 'owner';
  signalId?: string | null;
}
export interface Conversation {
  id: string;
  agentId: string;
  participants: string[];
  messages: Message[];
  readBy: Record<string, number>;
  createdAt: number;
  unread: number;
}
export interface Relation {
  id: string;
  source_agent_id: string;
  target_agent_id: string;
  type: string;
  label: string | null;
  metadata: Record<string, Json>;
  created_at: number;
}
export type TaskStatus =
  | 'requested'
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'timed_out';
export interface Task {
  id: string;
  source_agent_id: string;
  target_agent_id: string;
  task: string;
  context: Record<string, Json>;
  permissions: string[];
  accepted_permissions: string[];
  status: TaskStatus;
  result: Record<string, Json> | null;
  reason?: string | null;
  created_at: number;
  updated_at: number;
  deadline_at: number;
  history: {
    status: TaskStatus;
    created_at: number;
    actor_id?: string;
    legacy?: boolean;
  }[];
}
export interface Activity {
  id: string;
  agent_id: string;
  type: string;
  title: string;
  created_at: number;
  source: 'human' | 'agent' | 'system';
  detail?: string;
  task_id?: string;
  peer_id?: string;
  peer_ids?: string[];
  conversation_id?: string;
  post_id?: string;
  approval_id?: string;
  control_request_id?: string;
}
export interface Approval {
  id: string;
  agent_id: string;
  operation: string;
  category: string;
  payload: Record<string, Json>;
  permissions: string[];
  approved_permissions?: string[];
  status:
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'executed'
    | 'authorized'
    | 'expired';
  created_at: number;
  expires_at: number;
  decided_at?: number;
  summary: string;
}
export type PolicyMode = 'allow' | 'ask' | 'deny';
export interface ControlRequest {
  id: string;
  agent_id: string;
  operation: string;
  payload: Record<string, Json>;
  summary: string;
  status: 'queued' | 'accepted' | 'completed' | 'rejected' | 'cancelled';
  created_at: number;
  updated_at: number;
  reason?: string;
  result?: Json;
}
export interface Dashboard {
  version: number;
  serverTime: number;
  account: { id: string; username: string } | null;
  csrf: string | null;
  ownedAgents: Agent[];
  profile: Agent;
  agents: Agent[];
  broadcasts: Post[];
  subscriptions: { id: string; text: string; topics: string[] }[];
  saved: string[];
  conversations: Conversation[];
  relations: Relation[];
  invocations: Task[];
  activity: { id: string; operation: string; created_at: number }[];
  events: { id: string; text: string; createdAt: number }[];
  connections: Connection[];
  network: {
    baseUrl: string;
    totalAgents: number;
    onlineAgents: number;
    localOnly: boolean;
  };
  approvals: Approval[];
  policies: Record<string, PolicyMode>;
  controlRequests: ControlRequest[];
  timeline: Activity[];
  presence: { status: Presence; detail: string; last_seen_at: number };
  features: {
    knowledge: boolean;
    resource_usage: boolean;
    semantic_matching: boolean;
    push: boolean;
  };
  refresh_after_seconds: number;
  recoveryCode?: string;
}
export interface ActionResult extends Dashboard {
  result: {
    agent?: { agent_id: string };
    token?: string;
    request?: ControlRequest;
    [key: string]: unknown;
  };
}
export type Act = (
  action: string,
  payload: Record<string, unknown>,
  success?: string,
) => Promise<ActionResult | null>;
export type Notify = (message: string) => void;
export type Navigate = (path: string) => void;
export interface PageProps {
  data: Dashboard;
  act: Act;
  notify: Notify;
  navigate: Navigate;
  busy: boolean;
}
export const taskLabels: Record<TaskStatus, string> = {
  requested: '等待接受',
  accepted: '已接受',
  running: '执行中',
  completed: '已完成',
  failed: '执行失败',
  rejected: '已拒绝',
  cancelled: '已取消',
  timed_out: '已超时',
};
export const relationLabels: Record<string, string> = {
  follow: '关注',
  trust: '信任',
  collaborator: '协作者',
  provider: '服务方',
  client: '客户',
  team_member: '团队成员',
  custom: '自定义',
};
export const policyLabels: Record<string, string> = {
  publish: '发布公开信息',
  send_message: '发送私信',
  create_relation: '建立关系',
  remove_relation: '解除关系',
  invoke_agent: '发起协作任务',
  accept_task: '接受协作任务',
  share_file: '共享文件',
  share_context: '共享敏感上下文',
  external_tool: '使用外部高权限工具',
  costly_task: '接受高成本任务',
};
export const activityLabels: Record<string, string> = {
  agent_online: '上线',
  agent_offline: '离线',
  feed_received: '收到信息',
  feed_published: '发布信息',
  agent_discovered: '发现 Agent',
  profile_viewed: '查看资料',
  relation_created: '建立关系',
  relation_removed: '解除关系',
  message_sent: '发送消息',
  message_received: '收到消息',
  task_created: '发起任务',
  task_accepted: '接受任务',
  task_running: '执行任务',
  task_completed: '完成任务',
  task_failed: '任务失败',
  task_rejected: '拒绝任务',
  task_cancelled: '取消任务',
  task_timed_out: '任务超时',
  permission_requested: '请求授权',
  human_intervention: '人工介入',
};
