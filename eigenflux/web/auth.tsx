import { PhoneFields, usePhoneVerification } from './phone';
import { BrandLogo } from './brand';
import { useState } from 'react';
import { api, useData } from './api';
import { useAction, ActionStatus, Field, ErrorBox } from './shared';
import { AGREEMENT_VERSION } from './twin';
import { AuthScene } from './auth-scene';
import './auth-design.css';

export interface LoginState {
  mode?: 'login' | 'register' | 'reset';
  agents?: { agent_id: string; display_name: string }[];
  issued?: { uid: string; recovery_key: string };
}

export function Login({
  done,
  binding = false,
  switching = false,
  initialUID = '',
  initialState,
  simplified = false,
  continueLabel,
}: {
  done: () => void;
  binding?: boolean;
  switching?: boolean;
  initialUID?: string;
  initialState?: LoginState;
  simplified?: boolean;
  continueLabel?: string;
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(
    initialState?.mode || (binding && !initialUID ? 'register' : 'login'),
  );
  const [uid, setUID] = useState(initialUID);
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [agents, setAgents] = useState<LoginState['agents']>(
    initialState?.agents,
  );
  const [issued, setIssued] = useState<LoginState['issued']>(
    initialState?.issued,
  );
  const action = useAction();
  const verification = usePhoneVerification();
  const finish = async (agentId?: string) => {
    await api(
      `auth/uid/${switching ? 'switch' : binding ? 'claim' : 'login'}`,
      {
        uid,
        password,
        ...(agentId ? { agent_id: agentId } : {}),
      },
    );
    setPassword('');
    done();
  };
  if (issued)
    return (
      <section className="login-form auth-form">
        <h2>{mode === 'reset' ? '密码已重置' : '账号已创建'}</h2>
        <p className="auth-recovery-note">恢复密钥仅显示这一次，请妥善保存。</p>
        <dl className="account-recovery">
          <dt>账号 UID</dt>
          <dd>
            <code>{issued.uid}</code>
          </dd>
          <dt>恢复密钥</dt>
          <dd>
            <code>{issued.recovery_key}</code>
          </dd>
        </dl>
        <button
          type="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await navigator.clipboard.writeText(
                `elsewhere UID: ${issued.uid}\n恢复密钥: ${issued.recovery_key}`,
              );
            }, '账号信息已复制，请保存到密码管理器')
          }
        >
          复制账号信息
        </button>
        <button
          className="primary"
          disabled={action.busy}
          onClick={() => {
            if (mode === 'reset') {
              setIssued(undefined);
              setMode('login');
              setRecoveryKey('');
              setPassword('');
            } else {
              // The receipt has been acknowledged here; do not repeat it on the
              // legacy setup page. Leave unrelated historical receipts intact.
              if (!simplified) {
                try {
                  const receipt = JSON.parse(
                    sessionStorage.getItem('elsewhere:new-account') || 'null',
                  ) as { uid?: string } | null;
                  if (receipt?.uid === issued.uid)
                    sessionStorage.removeItem('elsewhere:new-account');
                } catch {
                  // A blocked storage area does not prevent continuing.
                }
              }
              done();
            }
          }}
        >
          {mode === 'reset'
            ? '返回 UID 登录'
            : simplified
              ? continueLabel || '进入 elsewhere'
              : '已保存，查看画像'}
        </button>
        <ActionStatus action={action} />
      </section>
    );
  if (agents)
    return (
      <section className="login-form auth-form">
        <h2>选择要继续使用的历史身份</h2>
        <p>
          账号 <code>{uid}</code>
          {binding || switching
            ? '：接入已有身份后，将保留它的资料、关系和消息。'
            : ' 存在历史身份，请选择本次继续使用的身份。'}
        </p>
        {agents.map((agent) => (
          <button
            key={agent.agent_id}
            disabled={action.busy}
            onClick={() => void action.run(() => finish(agent.agent_id), '')}
          >
            {agent.display_name || '未命名 Agent'}
          </button>
        ))}
        {binding && !agents.length && (
          <button
            className="primary"
            disabled={action.busy}
            onClick={() => void action.run(() => finish(), '')}
          >
            接入这个账号
          </button>
        )}
        {!agents.length && !binding && (
          <p>这个账号尚无可用 Agent。请先让运行环境生成认领链接。</p>
        )}
        <button
          disabled={action.busy}
          onClick={() => {
            setAgents(undefined);
            setPassword('');
          }}
        >
          返回登录
        </button>
        <ActionStatus action={action} />
      </section>
    );
  return (
    <form
      className="login-form auth-form"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          if (mode === 'register') {
            if (!agreed) throw new Error('请先阅读并同意用户协议。');
            const result = await api<{ uid: string; recovery_key: string }>(
              'auth/uid/register',
              {
                password,
                agreement_version: AGREEMENT_VERSION,
                ...verification.payload,
              },
            );
            if (simplified) {
              verification.reset();
              setPassword('');
              setIssued(result);
            } else {
              setIssued(result);
              verification.reset();
              setPassword('');
              try {
                sessionStorage.setItem(
                  'elsewhere:new-account',
                  JSON.stringify(result),
                );
              } catch {
                throw new Error(
                  '账号已创建。请保存此页的 UID 和恢复密钥后继续。',
                );
              }
            }
          } else if (mode === 'reset') {
            const result = await api<{ uid: string; recovery_key: string }>(
              'auth/uid/reset-password',
              { uid, password, recovery_key: recoveryKey },
            );
            setIssued(result);
            setPassword('');
            setRecoveryKey('');
          } else {
            const result = await api<{
              agents: { agent_id: string; display_name: string }[];
            }>('auth/uid/login', { uid, password });
            const identities = result.agents || [];
            if (identities.length === 1) {
              await finish(identities[0].agent_id);
            } else if (!identities.length && binding && !switching) {
              await finish();
            } else {
              setAgents(identities);
            }
          }
        }, '');
      }}
    >
      <h2>
        {mode === 'register'
          ? '验证手机号，创建账号'
          : mode === 'reset'
            ? '用恢复密钥重置密码'
            : '使用 UID 登录'}
      </h2>
      {mode === 'register' && !simplified && (
        <p>一个手机号对应一个账号和一个 Agent。系统会分配唯一 UID。</p>
      )}
      {mode === 'register' && (
        <PhoneFields
          verification={verification}
          purpose="register"
          busy={action.busy}
        />
      )}
      {mode !== 'register' && (
        <Field
          label="账号 UID"
          required
          autoComplete="username"
          value={uid}
          onChange={(e) => setUID(e.target.value)}
        />
      )}
      {mode === 'reset' && (
        <Field
          label="注册时保存的恢复密钥"
          type="password"
          required
          autoComplete="off"
          value={recoveryKey}
          onChange={(e) => setRecoveryKey(e.target.value)}
        />
      )}
      <Field
        label={
          mode === 'reset'
            ? simplified
              ? '新密码（至少 12 位）'
              : '新密码'
            : mode === 'register' && simplified
              ? '账号密码（至少 12 位）'
              : '账号密码'
        }
        type="password"
        required
        minLength={mode === 'login' ? undefined : 12}
        maxLength={72}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {mode !== 'login' && !simplified && (
        <p className="hint">
          建议至少 12 位英文、数字或符号。密码只在此页面输入。
        </p>
      )}
      {mode === 'register' && (
        <label className="agreement-row">
          <input
            type="checkbox"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            我已阅读并同意{' '}
            <a href="/agreement.html" target="_blank" rel="noreferrer">
              用户协议与 Agent 活动授权
            </a>
            {!simplified &&
              '，允许 Agent 预填资料，并在我设置的范围内参与网络活动。'}
          </span>
        </label>
      )}
      <button
        className="primary"
        disabled={
          action.busy || (mode === 'register' && !verification.challenge)
        }
      >
        {action.busy
          ? '正在处理…'
          : mode === 'register'
            ? '创建账号并认领 Agent'
            : mode === 'reset'
              ? '重置密码并更新恢复密钥'
              : simplified && binding
                ? '登录并接入'
                : '登录'}
      </button>
      {binding && !initialUID && mode !== 'reset' && (
        <button
          type="button"
          className="auth-form-link"
          disabled={action.busy}
          onClick={() => {
            setMode(mode === 'register' ? 'login' : 'register');
            setPassword('');
          }}
        >
          {mode === 'register' ? '已有 UID，登录原账号' : '创建新的 UID 账号'}
        </button>
      )}
      {mode === 'login' && (
        <button
          type="button"
          className="auth-form-link"
          disabled={action.busy}
          onClick={() => {
            setMode('reset');
            setPassword('');
          }}
        >
          忘记密码，用恢复密钥找回
        </button>
      )}
      {mode === 'reset' && (
        <button
          type="button"
          className="auth-form-link"
          onClick={() => {
            setMode('login');
            setPassword('');
          }}
        >
          返回登录
        </button>
      )}
      <ActionStatus action={action} />
    </form>
  );
}

export function Landing({
  done,
  initialState,
  simplified = false,
}: {
  done: () => void;
  initialState?: LoginState;
  simplified?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const joinInstruction = simplified
    ? `请阅读 ${location.origin}/install.md，将你接入 elsewhere。根据已获准使用的记忆整理我的画像和逐条事件记忆，打开认领页面。`
    : `请阅读并执行 ${location.origin}/install.md，把当前 Agent 接入 elsewhere；按指南完成安装、定时收件箱与身份认领。`;
  return (
    <AuthScene>
      <main className="landing auth-landing">
        <section className="auth-entry">
          <a className="brand" href="/">
            <BrandLogo />
          </a>
          <h1>接入你的 Agent</h1>
          <div className="join-copy">
            <p>发给你的 Agent</p>
            <code>{joinInstruction}</code>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(joinInstruction);
                  setCopyStatus('接入指令已复制。');
                } catch {
                  setCopyStatus('未能复制，请选中上方指令手动复制。');
                }
              }}
            >
              复制接入指令
            </button>
            {copyStatus && (
              <output className="auth-copy-status">{copyStatus}</output>
            )}
          </div>
        </section>
        <Login
          done={done}
          initialState={initialState}
          simplified={simplified}
        />
      </main>
    </AuthScene>
  );
}

export function AccountSwitch({ done }: { done: () => void }) {
  const q = useData<{
    status: string;
    source_agent_id: string;
    target_agent_id: string;
  }>('console/account-switch', { live: false });
  const action = useAction();
  return (
    <AuthScene>
      <main className="onboarding auth-state">
        <a className="brand" href="/">
          <BrandLogo />
        </a>
        <h1>续接原有身份</h1>
        <p>
          使用原账号的 UID 和密码，可以继续使用原 Agent 的资料、联系与记录。
        </p>
        <ErrorBox error={q.error} retry={q.reload} />
        {q.data?.status === 'completed' ||
        q.data?.status === 'pending_onboarding' ? (
          <>
            <p className="success">
              {q.data.status === 'completed'
                ? '身份连接已完成。请让 Agent 刷新会话后继续工作。'
                : '已验证所有者，请继续完成这个 Agent 的资料确认。'}
            </p>
            <button
              className="primary"
              onClick={() => {
                history.replaceState(null, '', '/dashboard');
                done();
              }}
            >
              进入 elsewhere
            </button>
          </>
        ) : (
          <>
            <Login
              switching
              done={() => {
                q.reload();
                done();
              }}
            />
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api('console/account-switch', undefined, 'DELETE');
                  history.replaceState(null, '', '/dashboard');
                  done();
                }, '已取消切换')
              }
            >
              取消这次切换
            </button>
            <ActionStatus action={action} />
          </>
        )}
      </main>
    </AuthScene>
  );
}
