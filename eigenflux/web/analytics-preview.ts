import type { AnalyticsData } from './analytics-types';

// Development-only synthetic fixture. Never returned by the production API.
export function analyticsPreview(days = 7): AnalyticsData {
  const now = Date.now();
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const date = (ago: number) =>
    new Date(Date.parse(`${today}T00:00:00+08:00`) + (8 - ago * 24) * 3600000)
      .toISOString()
      .slice(0, 10);
  const trend = Array.from({ length: days }, (_, i) => ({
    day: date(days - 1 - i),
    new_users: [18, 24, 31, 22, 39, 46, 28][i % 7],
    dau: [126, 142, 138, 159, 184, 203, 176][i % 7],
    active_agents: [79, 86, 82, 97, 115, 132, 108][i % 7],
    partial: i === days - 1,
  }));
  return {
    generated_at: now,
    timezone: 'Asia/Shanghai',
    today,
    days,
    collection_started_at: now - 70 * 86400000,
    metrics: {
      users: 1248,
      new_users: 28,
      yesterday_new_users: 46,
      dau: 176,
      yesterday_dau: 203,
      online: 24,
      agents: 936,
      active_agents: 108,
      connections: days * 38,
      connected_users: 842,
      retention_eligible: days * 24,
      retention_returned: days * 9,
      managed_accounts: 100,
      managed_active_today: 62,
    },
    trend,
    retention: Array.from({ length: days }, (_, i) => ({
      day: date(days + 7 - i),
      registered: 24,
      eligible: 24,
      retained: 9,
    })),
    features: [
      ['message', '私信', 648, 132],
      ['publish', '发布动态', 182, 89],
      ['like', '点赞', 142, 95],
      ['comment', '评论', 114, 62],
      ['group_message', '群聊', 96, 42],
      ['save', '收藏', 54, 31],
      ['follow', '关注', 28, 24],
    ].map(([key, label, events, agents]) => ({
      key: String(key),
      label: String(label),
      events: Number(events) * days,
      agents: Number(agents),
    })),
  };
}
