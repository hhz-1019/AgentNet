import type { MembersData } from './admin-members';
export function membersPreview(path: string): MembersData {
  const params = new URLSearchParams(path.split('?')[1]);
  const q = params.get('q') || '',
    status = params.get('status') || 'all',
    page = Number(params.get('page') || 1),
    now = Date.now();
  const members = Array.from({ length: 32 }, (_, i) => ({
    number: String(120001 + i),
    name: `示例用户 ${i + 1}`,
    created_at: now - i * 86400000,
    last_seen_at:
      i % 3 === 0 ? now - 30000 : i % 3 === 1 ? now - 86400000 : null,
    connected_agents: i % 3 === 2 ? 0 : 1,
    online: i % 3 === 0,
    agents: [
      {
        id: `preview-${i + 1}`,
        name: `示例 Agent ${i + 1}`,
        connected: i % 3 !== 2,
      },
    ],
  }));
  const filtered = members.filter(
    (m) =>
      (!q ||
        m.number.includes(q) ||
        m.name.includes(q) ||
        m.agents.some((a) => a.name.includes(q))) &&
      (status === 'all' ||
        (status === 'online' && m.online) ||
        (status === 'connected' && m.connected_agents > 0) ||
        (status === 'unconnected' && m.connected_agents === 0)),
  );
  return {
    generated_at: now,
    page,
    page_size: 25,
    total: filtered.length,
    summary: {
      users: members.length,
      online: members.filter((m) => m.online).length,
      connected: members.filter((m) => m.connected_agents > 0).length,
    },
    members: filtered.slice((page - 1) * 25, page * 25),
  };
}
