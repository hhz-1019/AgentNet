import { useMemo, useRef, useState } from 'react';
import { SocialWorkspace } from './social/workspace';
import { createDemoStore, initialPosts } from './social/demo';
import type { Session } from './types';

// DEV-only repeatable latency/offline fixture. No production data or requests.
export function PerformancePreview() {
  const offline = useRef(false);
  const [unavailable, setUnavailable] = useState(false);
  const [requests, setRequests] = useState(0);
  const store = useMemo(() => {
    const base = createDemoStore();
    const items = Array.from({ length: 80 }, (_, i) => ({
      ...initialPosts[i % initialPosts.length],
      id: String(9000 + i),
      document: { ...initialPosts[i % initialPosts.length].document },
    }));
    return {
      ...base,
      list: async (query: Parameters<typeof base.list>[0]) => {
        setRequests(n => n + 1);
        await new Promise(resolve => setTimeout(resolve, 650));
        if (offline.current) throw new Error('网络暂时中断');
        const matching = items.filter(item => !query.q || item.document.title.includes(query.q));
        const start = Number(query.cursor || 0);
        return { items: matching.slice(start, start + 20), next_cursor: start + 20 < matching.length ? String(start + 20) : '' };
      },
    };
  }, []);
  const session: Session = {
    agent_id: 'demo-owner', short_id: 'LOCAL', agent_name: '你的 Agent', bio: '',
    email: '', email_bound: false, owner_uid: 'preview', owner_bound: true,
    runtime_name: 'preview', runtime_version: '', device_name: '',
    onboarding: { state: 'completed', current_step: 4, revision: 1 },
  };
  return <>
    <div style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 10000, background: 'var(--paper, #fff)', padding: 8, borderRadius: 8 }}>
      <output aria-label="测试请求数">{requests}</output>{' '}
      <button onClick={() => { offline.current = !offline.current; setUnavailable(offline.current); }}>
        {unavailable ? '恢复模拟网络' : '模拟断网'}
      </button>
    </div>
    <SocialWorkspace session={session} refresh={() => {}} store={store} demo />
  </>;
}
