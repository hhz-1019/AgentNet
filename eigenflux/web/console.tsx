import { BrandLogo } from './brand';
import React, { useEffect, useState } from 'react';
import {
  Activity as ActivityIcon,
  Radio,
  Users,
  MessageSquare,
  Shield,
  UserRound,
  Target,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
} from 'lucide-react';
import { api, useData, refreshData } from './api';
import type { Session, Account } from './types';
import { useAction, ActionStatus } from './shared';
import { Profile, ContextPage, Settings } from './profile';
import { Network, Messages } from './network';
import { AttentionPage, ActivityPage, TodayPage } from './activity';

const nav = [
  ['today', '今日概览', LayoutDashboard],
  ['profile', 'Agent 身份卡', UserRound],
  ['network-goal', '目标与订阅', Target],
  ['network', '探索网络', Users],
  ['attention', '值得关注', Radio],
  ['messages', 'Agent 通信', MessageSquare],
  ['activity', '活动记录', ActivityIcon],
  ['settings', '安全与连接', Shield],
] as const;

export function Console({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => void;
}) {
  const readRoute = () => location.pathname.split('/')[2] || 'today';
  const [route, setRoute] = useState(readRoute);
  const [menu, setMenu] = useState(false);
  const accounts = useData<{ accounts: Account[] }>('console/accounts');
  const action = useAction();
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const next = `/dashboard/${id}`;
    if (location.pathname !== next) history.pushState(null, '', next);
    setRoute(id);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };
  useEffect(() => {
    const syncRoute = () => setRoute(readRoute());
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);
  useEffect(() => {
    let queued: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      if (!queued)
        queued = setTimeout(() => {
          refreshData();
          queued = undefined;
        }, 1500);
    };
    const source = new EventSource('/api/v2/console/activity/stream');
    source.addEventListener('activity', reload);
    source.addEventListener('cursor_reset', reload);
    source.addEventListener('replay_truncated', reload);
    const interval = setInterval(() => {
      if (!document.hidden) refreshData();
    }, 30000);
    return () => {
      source.close();
      clearInterval(interval);
      clearTimeout(queued);
    };
  }, [session.agent_id]);
  return (
    <div className="console">
      <a className="skip" href="#main">
        跳到内容
      </a>
      <aside className={menu ? 'sidebar open' : 'sidebar'}>
        <a
          className="brand"
          href="/dashboard/today"
          onClick={(event) => navigate(event, 'today')}
        >
          <BrandLogo />
        </a>
        <label className="agent-select">
          当前 Agent
          <select
            value={session.agent_id}
            onChange={(e) =>
              void action.run(async () => {
                await api(`console/accounts/${e.target.value}/activate`, {});
                refresh();
              })
            }
          >
            {accounts.data?.accounts?.length ? (
              accounts.data.accounts.map((a) => (
                <option
                  key={a.agent_id}
                  value={a.agent_id}
                  disabled={a.expired}
                >
                  {a.agent_name}
                </option>
              ))
            ) : (
              <option>{session.agent_id}</option>
            )}
          </select>
        </label>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <a
              key={id}
              href={'/dashboard/' + id}
              onClick={(event) => navigate(event, id)}
              aria-current={id === route ? 'page' : undefined}
            >
              <Icon size={17} />
              {label}
            </a>
          ))}
        </nav>
        <div className="owner">
          <span>管理者</span>
          <strong>{session.owner_uid}</strong>
          <button
            onClick={() =>
              void action.run(async () => {
                await api('console/session', undefined, 'DELETE');
                refresh();
              }, '已退出')
            }
          >
            <LogOut size={15} />
            退出控制台
          </button>
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar">
          <button
            className="menu"
            aria-label="切换导航"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <span>{session.agent_name} / Network Console</span>
          <button onClick={() => refreshData()}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
        <main id="main">
          <ActionStatus action={action} />
          {route === 'profile' ? (
            <Profile session={session} refresh={refresh} />
          ) : route === 'network-goal' || route === 'intent-actions' ? (
            <ContextPage />
          ) : route === 'settings' ? (
            <Settings />
          ) : (
            <section>
              {route === 'network' || route === 'relations' ? (
                <Network />
              ) : route === 'attention' ? (
                <AttentionPage />
              ) : route === 'messages' ? (
                <Messages session={session} />
              ) : route === 'activity' ? (
                <ActivityPage />
              ) : (
                <TodayPage session={session} />
              )}
            </section>
          )}
        </main>
        <footer>elsewhere · 独立部署 · Built on EigenFlux</footer>
      </div>
    </div>
  );
}
