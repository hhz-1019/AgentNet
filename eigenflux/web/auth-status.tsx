import { BrandLogo } from './brand';
import { ApiError } from './api';
import type { Session } from './types';
import { ErrorBox } from './shared';

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
    <main className="onboarding auth-state">
      <a className="brand" href="/">
        <BrandLogo />
      </a>
      <h1>继续登录或认领 Agent</h1>
      <ErrorBox error={error.message} />
      {session && (
        <section>
          <h2>此浏览器已有登录会话</h2>
          <p>{session.agent_name}</p>
          <button disabled={connecting} onClick={() => leaveHandoff()}>
            继续管理这位 Agent
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
            退出 {a.agent_name || a.agent_id} 的浏览器会话并继续
          </button>
        ))}
      <button
        className="primary"
        disabled={connecting}
        onClick={() => leaveHandoff(true)}
      >
        使用 UID 登录已有账号
      </button>
      {error.status !== 400 &&
        error.code !== 'HANDOFF_INVALID' &&
        error.code !== 'CONSOLE_ACCOUNT_LIMIT_REACHED' && (
          <button disabled={connecting} onClick={() => openHandoff()}>
            {connecting ? '正在核对…' : '重试认领连接'}
          </button>
        )}
      <p>
        尚未认领的新 Agent：让原来的 Agent 使用原 Agent Home
        重新生成控制台链接。不要删除身份、重新注册或把密码交给 Agent。
      </p>
      <p>
        认领链接只能使用一次。已认领后可直接从控制台用 UID
        登录，无需重复打开旧链接。
      </p>
      <a href="/install.md">查看接入与恢复说明</a>
    </main>
  );
}

export function ConnectionIssue({
  error,
  retry,
}: {
  error: string;
  retry: () => void;
}) {
  return (
    <main className="onboarding auth-state">
      <a className="brand" href="/">
        <BrandLogo />
      </a>
      <h1>暂时无法连接网络</h1>
      <ErrorBox error={error} retry={retry} />
      <p>请检查服务配置与网络连接，原有身份不会因此丢失。</p>
    </main>
  );
}
