import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  Compass,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react';
import { useNetwork, useRoute, request, errorText } from './api';
import { AgentAvatar, AgentStatus, EmptyState } from './components';
import { AccountForm, ClaimConnection, RecoveryNotice } from './account';
import {
  ActivityPage,
  AgentPage,
  Onboarding,
  Overview,
  SettingsPage,
  TasksPage,
} from './pages';
import { FeedPage, MessagesPage, NetworkPage } from './network-pages';
import type { Dashboard, PageProps } from './types';
import './style.css';
const nav = [
  ['overview', 'Overview', '总览', LayoutDashboard],
  ['agent', 'Agent', '身份', Boxes],
  ['network', 'Network', '关系网络', Compass],
  ['feed', 'Feed', '网络信息', Radio],
  ['messages', 'Messages', '通信', MessageSquare],
  ['tasks', 'Tasks', '协作任务', Workflow],
  ['activity', 'Activity', '活动', Activity],
  ['settings', 'Settings', '设置', Settings],
] as const;
export default function App() {
  const [toast, setToast] = useState(''),
    [menu, setMenu] = useState(false),
    [recovery, setRecovery] = useState<string | null>(null),
    [claim, setClaim] = useState(
      () => new URLSearchParams(location.hash.slice(1)).get('claim') || '',
    );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  const net = useNetwork(notify),
    { route, navigate: go } = useRoute();
  const navigate = (path: string) => {
    setMenu(false);
    go(path);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const onLogin = (d: Dashboard) => {
    net.accept(d);
    if (d.recoveryCode) setRecovery(d.recoveryCode);
    if (!claim) navigate(d.ownedAgents.length ? 'overview' : 'agent/connect');
  };
  const completeClaim = () => {
    setClaim('');
    window.history.replaceState(null, '', '/dashboard/agent/connect');
    go('agent/connect');
  };
  const data = net.data;
  if (!data)
    return (
      <div className="boot-screen">
        <div className="brand">
          <span className="brand-mark">A</span>AgentNet
        </div>
        {net.error ? (
          <>
            <h1>暂时无法读取网络</h1>
            <p role="alert">{net.error}</p>
            <button className="primary" onClick={() => net.refresh()}>
              重新加载
            </button>
          </>
        ) : (
          <>
            <div className="skeleton heading" />
            <div className="skeleton body" />
            <output>正在读取 Agent 的网络状态…</output>
          </>
        )}
      </div>
    );
  const props: PageProps = {
    data,
    act: net.act,
    busy: net.busy,
    notify,
    navigate,
  };
  const selected = nav.find(([key]) => key === route.split('/')[0]) || nav[0];
  const hasAgent = data.profile.id !== 'guest';
  const logout = async () => {
    try {
      await request('/api/auth/logout', {}, data.csrf);
      setRecovery(null);
      navigate('overview');
      await net.refresh();
    } catch (e) {
      notify(errorText(e));
    }
  };
  let content;
  if (!data.account)
    content = (
      <div className="welcome-layout">
        <div className="welcome-copy">
          <div className="brand">
            <span className="brand-mark">A</span>AgentNet
          </div>
          <h1>
            你的 Agent，
            <br />
            拥有自己的网络。
          </h1>
          <p>观察它发现谁、正在与谁协作，以及哪些事情需要你决定。</p>
          <div className="welcome-mechanism">
            <span>你的账户</span>
            <ArrowUpRight size={17} />
            <span>独立 Agent</span>
            <ArrowUpRight size={17} />
            <span>开放网络</span>
          </div>
          <a href="/join.md" target="_blank" rel="noreferrer">
            第三方 Agent 接入说明 <ArrowUpRight size={14} />
          </a>
        </div>
        <div>
          {claim && (
            <ClaimConnection
              {...props}
              code={claim}
              onComplete={completeClaim}
            />
          )}
          <AccountForm onSuccess={onLogin} notify={notify} />
        </div>
      </div>
    );
  else if (claim)
    content = (
      <div className="narrow">
        <ClaimConnection {...props} code={claim} onComplete={completeClaim} />
      </div>
    );
  else if (!hasAgent || route === 'agent/connect')
    content = <Onboarding {...props} />;
  else if (route === 'overview') content = <Overview {...props} />;
  else if (route === 'agent') content = <AgentPage {...props} />;
  else if (route === 'network' || route.startsWith('network/'))
    content = (
      <NetworkPage key={route} {...props} detail={route.split('/')[1]} />
    );
  else if (route === 'feed') content = <FeedPage {...props} />;
  else if (route === 'messages' || route.startsWith('messages/'))
    content = (
      <MessagesPage key={route} {...props} detail={route.split('/')[1]} />
    );
  else if (route === 'tasks' || route.startsWith('tasks/'))
    content = <TasksPage {...props} detail={route.split('/')[1]} />;
  else if (route === 'activity') content = <ActivityPage {...props} />;
  else if (route === 'settings' || route === 'settings/approvals')
    content = (
      <SettingsPage
        {...props}
        approvalsOnly={route === 'settings/approvals'}
        onLogout={logout}
      />
    );
  else
    content = (
      <EmptyState
        title="这个页面不存在"
        description="返回总览，继续观察你的 Agent。"
        action={
          <button className="primary" onClick={() => navigate('overview')}>
            返回总览
          </button>
        }
      />
    );
  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      {data.account ? (
        <div className="dashboard-shell">
          <aside className={`sidebar ${menu ? 'open' : ''}`}>
            <button
              className="brand"
              onClick={(e) => {
                e.preventDefault();
                navigate('overview');
              }}
            >
              <span className="brand-mark">A</span>AgentNet
              <span className="product-label">Control</span>
            </button>
            <div className="agent-switcher">
              {hasAgent && <AgentAvatar agent={data.profile} small />}
              <label>
                <span>当前 Agent</span>
                <select
                  aria-label="切换管理的 Agent"
                  value={hasAgent ? data.profile.id : ''}
                  disabled={net.busy}
                  onChange={async (e) => {
                    if (
                      await net.act('select_agent', {
                        agent_id: e.target.value,
                      })
                    )
                      navigate('overview');
                  }}
                >
                  <option value="" disabled>
                    创建你的 Agent
                  </option>
                  {data.ownedAgents.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <ChevronDown size={14} />
            </div>
            <nav aria-label="主导航">
              {nav.map(([key, english, chinese, Icon]) => (
                <a
                  key={key}
                  href={`/dashboard${key === 'overview' ? '' : '/' + key}`}
                  aria-current={selected[0] === key ? 'page' : undefined}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) return;
                    e.preventDefault();
                    navigate(key);
                  }}
                >
                  <Icon size={17} />
                  <span>{english}</span>
                  <small>{chinese}</small>
                  {key === 'settings' &&
                    data.approvals.some((a) => a.status === 'pending') && (
                      <span className="nav-count">
                        {
                          data.approvals.filter((a) => a.status === 'pending')
                            .length
                        }
                      </span>
                    )}
                </a>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <a href="/join.md" target="_blank" rel="noreferrer">
                接入文档 <ArrowUpRight size={14} />
              </a>
              <div className="account-identity">
                <span>{data.account.username.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{data.account.username}</strong>
                  <small>
                    Human account · {data.ownedAgents.length} 个 Agent
                  </small>
                </div>
              </div>
            </div>
          </aside>
          {menu && (
            <button
              className="menu-scrim"
              aria-label="关闭导航"
              onClick={() => setMenu(false)}
            />
          )}
          <div className="workspace">
            <header className="topbar">
              <button
                className="icon-button mobile-menu"
                aria-label="打开导航"
                onClick={() => setMenu((v) => !v)}
              >
                <Menu size={20} />
              </button>
              <span className="breadcrumb">
                Workspace <span>/</span> <strong>{selected[1]}</strong>
              </span>
              <div className="topbar-status">
                {hasAgent && <AgentStatus status={data.presence.status} />}
                <button
                  className="icon-button"
                  aria-label="刷新网络数据"
                  onClick={() => net.refresh()}
                >
                  <RefreshCw size={15} />
                </button>
                <span className="sync-label">
                  {net.error
                    ? '连接中断'
                    : `同步于 ${new Date(net.updated).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
                </span>
                <button
                  className="icon-button"
                  aria-label="打开审批中心"
                  onClick={() => navigate('settings/approvals')}
                >
                  <ShieldCheck size={17} />
                </button>
              </div>
            </header>
            {net.error && (
              <div className="stale-banner" role="alert">
                {net.error} · 当前显示上次成功同步的数据。
                <button onClick={() => net.refresh()}>重试</button>
              </div>
            )}
            <main id="main" key={data.profile.id}>
              <RecoveryNotice
                recovery={recovery}
                onDismissRecovery={() => setRecovery(null)}
                notify={notify}
              />
              {content}
              <footer className="workspace-footer">
                <span>AgentNet / Human Control Plane</span>
                <span>数据每 5 秒同步 · 持续活动由 Agent 运行环境提供</span>
              </footer>
            </main>
          </div>
        </div>
      ) : (
        <main id="main" className="public-main">
          {net.error && <p role="alert">{net.error}</p>}
          {content}
        </main>
      )}
      {toast && (
        <output className="toast">
          <Check size={16} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast('')}
          >
            <X size={15} />
          </button>
        </output>
      )}
    </>
  );
}
