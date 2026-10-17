import { feedbackMessage } from './feedback-message';
import { startPerformanceMetrics } from './performance-metrics';
startPerformanceMetrics();
import { ContentState, RecoveryPage } from './recovery';
import { createSessionRefresh } from './session-refresh';
import { requiresOwnerLogin } from './entry-route';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError } from './api';
import type { Session } from './types';
import { HandoffIssue, ConnectionPending } from './auth-status';
import { Landing, AccountSwitch } from './auth';
const Onboard = React.lazy(() =>
  import('./onboarding-view').then((m) => ({ default: m.Onboard })),
);
import { PublicCard } from './public-agent';
import { Console } from './console';
import { BrandEntry } from './brand-entry';
const Recruiting = React.lazy(() =>
  import('./recruiting').then((m) => ({ default: m.Recruiting })),
);
import { useAnalyticsHeartbeat } from './analytics-heartbeat';
const AnalyticsDashboard = React.lazy(() =>
  import('./analytics').then((module) => ({
    default: module.AnalyticsDashboard,
  })),
);
const AdminMembers = React.lazy(() =>
  import('./admin-members').then((module) => ({
    default: module.AdminMembers,
  })),
);
const AdminRegistration = React.lazy(() =>
  import('./admin-registration').then((module) => ({
    default: module.AdminRegistration,
  })),
);
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
  const [refresh] = useState(() =>
    createSessionRefresh(() => api<Session>('console/session'), {
      current: (current) => {
        setError('');
        lastAccount.current = current.owner_uid || lastAccount.current;
        const account = new URL(location.href).searchParams.get('account');
        setSession(account && current.owner_uid !== account ? null : current);
      },
      unauthorized: () => {
        setError('');
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
      },
      unavailable: (e) => setError(feedbackMessage(e, '连接失败')),
    }),
  );
  const reconnecting = Boolean(error);
  useEffect(() => {
    if (isVisualPreview || !reconnecting) return;
    let stopped = false;
    let running = false;
    let delay = 5000;
    let timer: ReturnType<typeof setTimeout>;
    const retry = async () => {
      if (stopped || running) return;
      running = true;
      const recovered = await refresh();
      running = false;
      if (!stopped && !recovered) {
        delay = Math.min(delay * 2, 30000);
        timer = setTimeout(() => void retry(), delay);
      }
    };
    const online = () => {
      clearTimeout(timer);
      delay = 5000;
      void retry();
    };
    timer = setTimeout(() => void retry(), delay);
    window.addEventListener('online', online);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', online);
    };
  }, [reconnecting, refresh]);
  useEffect(() => {
    if (isVisualPreview) return;
    const update = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === 'activity') return;
      void refresh();
    };
    window.addEventListener('agentnet:refresh', update);
    return () => window.removeEventListener('agentnet:refresh', update);
  }, [refresh]);
  const openHandoff = useCallback(
    async (replaceAgentId?: string) => {
      setConnecting(true);
      try {
        const url = initialURL.current,
          ticket = url.searchParams.get('ticket'),
          fragment = new URLSearchParams(url.hash.slice(1)),
          nonce = fragment.get('nonce'),
          connection = fragment.get('connect');
        if (connection) {
          const opened = await api<{
            requires_login: boolean;
            account?: string;
          }>('console/handoffs/exchange', {
            ticket: connection,
            ...(replaceAgentId ? { replace_agent_id: replaceAgentId } : {}),
          });
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
    },
    [refresh],
  );
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
  }, [openHandoff, refresh]);
  useEffect(() => {
    if (isVisualPreview) return;
    // This settles routing/auth only. BrandEntry also waits for the mounted
    // destination's first-page data and visible image preparation tasks.
    if (session !== undefined || error || handoffError) onReady(true);
    onFailure(
      Boolean(
        handoffError ||
        (error && session === undefined && location.pathname !== '/'),
      ),
    );
  }, [session, error, handoffError, onReady, onFailure]);
  if (isVisualPreview && VisualPreview)
    return (
      <React.Suspense
        fallback={<ContentState title="正在加载" loading quiet />}
      >
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
  if (error && session === undefined)
    return <ConnectionPending retry={() => void refresh()} />;
  if (session === undefined)
    return <ConnectionPending retry={() => void refresh()} />;
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
    return (
      <React.Suspense
        fallback={<ContentState title="正在加载" loading quiet />}
      >
        <AnalyticsDashboard />
      </React.Suspense>
    );
  if (location.pathname === '/dashboard/members')
    return (
      <React.Suspense
        fallback={<ContentState title="正在加载" loading quiet />}
      >
        <AdminMembers />
      </React.Suspense>
    );
  if (location.pathname === '/dashboard/registration')
    return (
      <React.Suspense
        fallback={<ContentState title="正在加载" loading quiet />}
      >
        <AdminRegistration />
      </React.Suspense>
    );
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
  if (location.pathname === '/recruiting')
    return (
      <React.Suspense
        fallback={<ContentState title="正在加载" loading quiet />}
      >
        <Recruiting />
      </React.Suspense>
    );
  return (
    <BrandEntry ready={ready} failed={failed}>
      <ThemeSync />
      <React.Suspense
        fallback={<ContentState title="正在加载" loading quiet />}
      >
        <AppContent onReady={setReady} onFailure={setFailed} />
      </React.Suspense>
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
  componentDidCatch(error: Error) {
    console.error('elsewhere app failed', error);
  }
  render() {
    if (this.state.failed)
      return <RecoveryPage retry={() => location.reload()} />;
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
