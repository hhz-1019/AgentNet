import { requiresOwnerLogin } from './entry-route';
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
import { BrandEntry } from './brand-entry';
import { useAnalyticsHeartbeat } from './analytics-heartbeat';
import { AnalyticsDashboard } from './analytics';
import { AdminMembers } from './admin-members';
import { AdminRegistration } from './admin-registration';
import './style.css';
import { ThemeSync } from './theme';

const VisualPreview = import.meta.env.DEV
  ? React.lazy(() => import('./visual-preview'))
  : null;
const isVisualPreview =
  !!VisualPreview && location.pathname.startsWith('/preview');

function PreviewReady({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady: (ready: boolean) => void;
}) {
  useEffect(() => {
    onReady(true);
  }, [onReady]);
  return children;
}

function AppContent({
  onReady,
  onFailure,
}: {
  onReady: (ready: boolean) => void;
  onFailure: (failed: boolean) => void;
}) {
  const [session, setSession] = useState<Session | null>(),
    [error, setError] = useState('');
  const [handoffError, setHandoffError] = useState<ApiError>();
  const [connecting, setConnecting] = useState(false);
  const initialURL = useRef(new URL(location.href));
  const lastAccount = useRef(
    initialURL.current.searchParams.get('account') || '',
  );
  const once = useRef(false);
  useAnalyticsHeartbeat(session?.owner_bound ? session.agent_id : undefined);
  async function refresh() {
    setError('');
    try {
      const current = await api<Session>('console/session');
      lastAccount.current = current.owner_uid || lastAccount.current;
      const account = new URL(location.href).searchParams.get('account');
      setSession(account && current.owner_uid !== account ? null : current);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        if (lastAccount.current && location.pathname.startsWith('/dashboard')) {
          const destination = new URL(location.href);
          destination.searchParams.set('account', lastAccount.current);
          history.replaceState(
            null,
            '',
            destination.pathname + destination.search + destination.hash,
          );
        }
        setSession(null);
      } else setError(e instanceof Error ? e.message : '连接失败');
    }
  }
  useEffect(() => {
    if (isVisualPreview) return;
    const update = () => {
      void refresh();
    };
    window.addEventListener('agentnet:refresh', update);
    return () => window.removeEventListener('agentnet:refresh', update);
  }, []);
  async function openHandoff(replaceAgentId?: string) {
    setConnecting(true);
    try {
      const url = initialURL.current,
        ticket = url.searchParams.get('ticket'),
        fragment = new URLSearchParams(url.hash.slice(1)),
        nonce = fragment.get('nonce'),
        connection = fragment.get('connect');
      if (connection) {
        const opened = await api<{ requires_login: boolean; account?: string }>(
          'console/handoffs/exchange',
          {
            ticket: connection,
            ...(replaceAgentId ? { replace_agent_id: replaceAgentId } : {}),
          },
        );
        history.replaceState(
          null,
          '',
          opened.account
            ? `/dashboard?account=${encodeURIComponent(opened.account)}`
            : '/dashboard',
        );
        setHandoffError(undefined);
        if (opened.requires_login) setSession(null);
        else await refresh();
        return;
      }
      if (
        (url.pathname === '/dashboard/handoff' || ticket || nonce) &&
        (!ticket || !nonce)
      )
        throw new ApiError(
          400,
          '页面无法打开，请登录账号继续。',
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
        e instanceof ApiError ? e : new ApiError(0, '暂时无法连接，请重试。');
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
  useEffect(() => {
    if (isVisualPreview) return;
    // This settles routing/auth only. BrandEntry also waits for the mounted
    // destination's first-page data and visible image preparation tasks.
    if (session !== undefined || error || handoffError) onReady(true);
    if (handoffError || (error && location.pathname !== '/')) onFailure(true);
  }, [session, error, handoffError, onReady, onFailure]);
  if (isVisualPreview && VisualPreview)
    return (
      <React.Suspense fallback={<Blank>正在加载…</Blank>}>
        <PreviewReady onReady={onReady}>
          <VisualPreview />
        </PreviewReady>
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
  if (
    location.pathname === '/' &&
    !session?.owner_bound &&
    (session !== undefined || error)
  )
    return <Landing done={() => void refresh()} />;
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
  if (!session)
    return (
      <Landing
        initialState={
          requiresOwnerLogin(location.pathname) ? { mode: 'login' } : undefined
        }
        initialAccount={
          new URL(location.href).searchParams.get('account') || ''
        }
        done={() => void refresh()}
      />
    );
  if (location.pathname === '/dashboard/account-switch')
    return <AccountSwitch done={() => void refresh()} />;
  if (session.owner_bound === false || session.onboarding.state !== 'completed')
    return (
      <Onboard
        key={session.agent_id}
        session={session}
        done={() => void refresh()}
      />
    );
  if (location.pathname === '/dashboard/analytics')
    return <AnalyticsDashboard />;
  if (location.pathname === '/dashboard/members') return <AdminMembers />;
  if (location.pathname === '/dashboard/registration')
    return <AdminRegistration />;
  return (
    <Console
      key={session.agent_id}
      session={session}
      refresh={() => void refresh()}
    />
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <BrandEntry ready={ready} failed={failed}>
      <ThemeSync />
      <AppContent onReady={setReady} onFailure={setFailed} />
    </BrandEntry>
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
