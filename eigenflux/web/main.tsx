import { BrandLogo } from './brand';
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError } from './api';
import type { Session } from './types';
import { Blank } from './shared';
import { HandoffIssue, ConnectionIssue } from './auth-status';
import { Landing, AccountSwitch } from './auth';
import { Onboard } from './onboarding-view';
import { PublicCard } from './public-agent';
import { Console } from './console';
import './style.css';

const VisualPreview = import.meta.env.DEV
  ? React.lazy(() => import('./visual-preview'))
  : null;
const isVisualPreview =
  !!VisualPreview && location.pathname.startsWith('/preview');

function App() {
  const [session, setSession] = useState<Session | null>(),
    [error, setError] = useState('');
  const [handoffError, setHandoffError] = useState<ApiError>();
  const [connecting, setConnecting] = useState(false);
  const initialURL = useRef(new URL(location.href));
  const once = useRef(false);
  async function refresh() {
    setError('');
    try {
      setSession(await api<Session>('console/session'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSession(null);
      else setError(e instanceof Error ? e.message : '连接失败');
    }
  }
  async function openHandoff(replaceAgentId?: string) {
    setConnecting(true);
    try {
      const url = initialURL.current,
        ticket = url.searchParams.get('ticket'),
        nonce = new URLSearchParams(url.hash.slice(1)).get('nonce');
      if (
        (url.pathname === '/dashboard/handoff' || ticket || nonce) &&
        (!ticket || !nonce)
      )
        throw new ApiError(
          400,
          '认领链接不完整，请复制完整链接，包括 #nonce 后的内容；也可以使用 UID 登录。',
          'HANDOFF_INCOMPLETE',
        );
      if (ticket && nonce) {
        const handoff = await api<{ account_switch: boolean }>(
          'console/handoffs/exchange',
          {
            ticket,
            browser_nonce: nonce,
            ...(replaceAgentId ? { replace_agent_id: replaceAgentId } : {}),
          },
        );
        history.replaceState(
          null,
          '',
          handoff.account_switch ? '/dashboard/account-switch' : '/dashboard',
        );
      }
      setHandoffError(undefined);
      await refresh();
    } catch (e) {
      const issue =
        e instanceof ApiError ? e : new ApiError(0, '认领暂未完成，请重试。');
      setHandoffError(issue);
      // A previous attempt may have succeeded before the response was lost.
      // Show the existing identity explicitly; never assume it is this ticket's Agent.
      try {
        setSession(await api<Session>('console/session'));
      } catch {
        setSession(null);
      }
    } finally {
      setConnecting(false);
    }
  }
  const leaveHandoff = (login = false) => {
    history.replaceState(null, '', '/dashboard');
    setHandoffError(undefined);
    setError('');
    if (login) setSession(null);
    else void refresh();
  };
  useEffect(() => {
    if (isVisualPreview) return;
    if (once.current) return;
    once.current = true;
    if (location.pathname.startsWith('/agent/')) void refresh();
    else void openHandoff();
  }, []);
  if (isVisualPreview && VisualPreview)
    return (
      <React.Suspense fallback={<Blank>正在加载…</Blank>}>
        <VisualPreview />
      </React.Suspense>
    );
  if (location.pathname.startsWith('/agent/'))
    return (
      <PublicCard
        session={session}
        sessionError={error}
        refresh={() => void refresh()}
      />
    );
  if (handoffError)
    return (
      <HandoffIssue
        error={handoffError}
        session={session}
        connecting={connecting}
        leaveHandoff={leaveHandoff}
        openHandoff={(id) => void openHandoff(id)}
      />
    );
  if (error)
    return <ConnectionIssue error={error} retry={() => location.reload()} />;
  if (session === undefined)
    return (
      <main className="onboarding">
        <a className="brand" href="/">
          <BrandLogo />
        </a>
        <Blank>正在连接你的 Agent…</Blank>
      </main>
    );
  if (!session) return <Landing done={() => void refresh()} />;
  if (location.pathname === '/dashboard/account-switch')
    return <AccountSwitch done={() => void refresh()} />;
  if (session.onboarding.state !== 'completed')
    return (
      <Onboard
        key={session.agent_id}
        session={session}
        done={() => void refresh()}
      />
    );
  return (
    <Console
      key={session.agent_id}
      session={session}
      refresh={() => void refresh()}
    />
  );
}

class AppErrorBoundary extends React.Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="onboarding">
          <a className="brand" href="/">
            <BrandLogo />
          </a>
          <h1>页面暂时无法显示</h1>
          <p role="alert">
            页面遇到了异常。已保存的账号与 Agent 身份仍然保留，无需重新注册。
          </p>
          <button onClick={() => location.reload()}>重新加载页面</button>
          <a href="/dashboard">返回控制台登录</a>
        </main>
      );
    return this.props.children;
  }
}

const root = createRoot(document.getElementById('root')!);

root.render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
