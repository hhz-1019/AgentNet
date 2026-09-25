export interface Onboarding {
  state: string;
  current_step: number;
  revision: number;
  active_context_revision?: number;
}
export interface Session {
  agent_id: string;
  short_id: string;
  agent_name: string;
  bio: string;
  email: string;
  email_bound: boolean;
  owner_uid: string;
  owner_bound: boolean;
  runtime_name: string;
  runtime_version: string;
  device_name: string;
  onboarding: Onboarding;
}
export interface Boundary {
  recurring_publish: boolean;
  auto_reply_pm: boolean;
  auto_comment: boolean;
  show_add_friend: boolean;
}
export interface Identity {
  agent_name: string;
  agent_description: string;
  bio?: string;
  working_languages: string[];
  seeking: string[];
  offering: string[];
  geo?: string;
  timezone?: string;
}
export interface Intent {
  intent_id?: string;
  watch_for: string;
  trigger_when: string;
  action_instruction?: string;
  then?: string;
  action_policy: string;
  priority: number;
}
export interface Draft {
  identity_card: Identity;
  network_goal: string;
  intent_actions: Intent[];
  security_boundary: Boundary;
}
export interface DraftResponse {
  onboarding: Onboarding;
  draft: { revision: number; data: Draft };
}
export interface Control {
  context_revision: number;
  control_context: {
    network_goal: { text: string };
    intent_actions: Intent[];
    security_boundary: Boundary;
  };
}
export interface Attention {
  attention_id: string;
  surface: string;
  category: string;
  title: string;
  body: string;
  recommendation: string;
  status: string;
  item_revision: number;
  created_at: number;
  actions: { action_key: string; flag: string; appearance: string }[];
}
export interface Today {
  runtime_state: string;
  last_heartbeat_at: number;
  network_goal: { text?: string; goal_text?: string };
  brief: {
    activity_count: number;
    encounter_count: number;
    participation_count: number;
    focus_count: number;
    narrative?: { state: string; text?: string; narrative?: string };
  };
  participation_items: Attention[];
  focus_items: Attention[];
}
export interface Activity {
  agent_seq: number;
  log_id: string;
  event_type: string;
  summary: string;
  created_at: number;
  detail: Record<string, unknown>;
}
export interface Peer {
  agent_id: string;
  short_id: string;
  agent_name: string;
  agent_description: string;
  capabilities: string[];
  is_friend: boolean;
  friend_request_pending: boolean;
  rule_key: string;
  show_add_friend: boolean;
}
export interface AgentContext {
  identity_assertion: { subject_id: string; display_name: string };
  card_summary: {
    agent_description: string;
    offering: string[];
    seeking: string[];
  };
  viewer_relation: string;
}
export interface Message {
  msg_id: string;
  sender_agent_id: string;
  receiver_agent_id: string;
  content: string;
  created_at: number;
  is_read: boolean;
}
export interface Conversation {
  conv_id: string;
  peer_agent_id: string;
  topic_status: string;
  unread_count: number;
  updated_at: number;
  last_message?: Message;
}
export interface Conversations {
  conversations: Conversation[];
  agent_contexts: Record<string, AgentContext>;
  next_cursor: string;
  has_more: boolean;
}
export interface Friend {
  peer_agent_id: string;
  remark: string;
  friend_since: number;
}
export interface Principal {
  principal_id: string;
  key_type: string;
  key_fingerprint: string;
  status: string;
  created_at: number;
  last_seen_at: number;
}
export interface Account {
  agent_id: string;
  agent_name: string;
  expired: boolean;
}
export interface Broadcast {
  item_id: string;
  content?: string;
  summary?: string;
  title?: string;
  created_at?: number;
  status?: number;
}
