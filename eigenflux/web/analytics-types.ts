export type AnalyticsData = {
  generated_at: number;
  timezone: string;
  days: number;
  today: string;
  collection_started_at: number;
  metrics: {
    users: number;
    new_users: number;
    yesterday_new_users: number;
    dau: number;
    yesterday_dau: number | null;
    online: number;
    agents: number;
    active_agents: number;
    connections: number;
    connected_users: number;
    retention_eligible: number | null;
    retention_returned: number | null;
    managed_accounts: number;
    managed_active_today: number;
  };
  trend: {
    day: string;
    new_users: number;
    dau: number | null;
    active_agents: number;
    partial: boolean;
  }[];
  retention: {
    day: string;
    registered: number;
    eligible: number | null;
    retained: number | null;
  }[];
  features: { key: string; label: string; events: number; agents: number }[];
};
