import { BrandLogo } from './brand';
import { ApiError } from './api';
import type { Session } from './types';
import { RecoveryPage } from './recovery';
import { feedbackMessage } from './feedback-message';
import { AuthScene } from './auth-scene';
import './auth-design.css';

export function HandoffIssue({
  error,
  session,
  connecting = false,
  leaveHandoff,
  openHandoff,
}: {
  error: ApiError;
  session?: Session | null;
  connecting?: boolean;
  leaveHandoff: (login?: boolean) => void;
  openHandoff: (agentId?: string) => void;
}) {
  const accounts = error.details?.accounts;
  return (
    <AuthScene>
      <main className="onboarding auth-state">
        <a className="brand" href="/">
          <BrandLogo />
        </a>
        <h1>登录 elsewhere</h1>
        <p className="hint">{feedbackMessage(error.message)}</p>
        {session?.owner_bound && (
          <section>
            <h2>继续使用已登录的 Agent</h2>
            <p>{session.agent_name}</p>
            <button disabled={connecting} onClick={() => leaveHandoff()}>
              继续使用 {session.agent_name}
            </button>
          </section>
        )}
        {error.code === 'CONSOLE_ACCOUNT_LIMIT_REACHED' &&
          Array.isArray(accounts) &&
          accounts.map((a: { agent_id: string; agent_name: string }) => (
            <button
              key={a.agent_id}
              disabled={connecting}
              onClick={() => openHandoff(a.agent_id)}
            >
              退出 {a.agent_name || '这位 Agent'} 并继续
            </button>
          ))}
        <button
          className="primary"
          disabled={connecting}
          onClick={() => leaveHandoff(true)}
        >
          登录账号
        </button>
        {error.status !== 400 &&
          error.code !== 'HANDOFF_INVALID' &&
          error.code !== 'CONSOLE_ACCOUNT_LIMIT_REACHED' && (
            <button disabled={connecting} onClick={() => openHandoff()}>
              {connecting ? '正在连接…' : '重新连接'}
            </button>
          )}
      </main>
    </AuthScene>
  );
}

// There is no previous content on a first visit. Keep a quiet loading shell
// while AppContent retries; never replace an already mounted workspace.
export function ConnectionPending({
  retry = () => location.reload(),
}: {
  retry?: () => void;
}) {
  return <RecoveryPage loading retry={retry} />;
}
