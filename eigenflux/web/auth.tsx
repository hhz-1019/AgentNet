import { PhoneFields, usePhoneVerification } from './phone';
import { BrandLogo } from './brand';
import { useId, useState } from 'react';
import { api, useData } from './api';
import { useAction, ActionStatus, Field, ErrorBox } from './shared';
import { AGREEMENT_VERSION } from './twin';
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
  const [mode, setMode] = useState<'login' | 'register'>(
    initialState?.mode === 'register'
      ? 'register'
      : binding && !initialUID
        ? 'register'
        : 'login',
  );
  const [uid, setUID] = useState(initialUID);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordMismatch =
    confirmPassword !== '' && confirmPassword !== password;
  const passwordErrorId = useId();
  const [agreed, setAgreed] = useState(false);
  const [agents, setAgents] = useState<
    { agent_id: string; display_name: string }[] | undefined
  >(initialState?.agents);
  const [issued, setIssued] = useState<{ uid: string } | undefined>(
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
        <h2>账号已创建</h2>
        <dl>
          <dt>账号 UID</dt>
          <dd>{issued.uid}</dd>
        </dl>
        <button className="primary" onClick={done}>
          {continueLabel || '查看并确认画像'}
        </button>
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
            if (!confirmPassword || confirmPassword !== password)
              throw new Error('两次输入的密码不一致，请重新确认。');
            if (!agreed) throw new Error('请先阅读并同意用户协议。');
            const created = await api<{ uid: string }>('auth/uid/register', {
              password,
              agreement_version: AGREEMENT_VERSION,
              ...verification.payload,
            });
            verification.reset();
            setPassword('');
            setConfirmPassword('');
            if (simplified) setIssued({ uid: created.uid });
            else done();
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
      <h2>{mode === 'register' ? '验证手机号，创建账号' : '使用 UID 登录'}</h2>
      <p>
        {mode === 'register'
          ? '一个手机号只能注册一个账号，对应一个 Agent。系统会分配唯一 UID。'
          : '登录后继续使用原有身份、资料、关系和消息。'}
      </p>
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
      <Field
        label="账号密码"
        type="password"
        required
        minLength={mode === 'login' ? undefined : 12}
        maxLength={72}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {mode !== 'login' && (
        <p className="hint">
          建议至少 12 位英文、数字或符号。密码只在此页面输入。
        </p>
      )}
      {mode === 'register' && (
        <>
          <Field
            label="确认密码"
            type="password"
            required
            minLength={12}
            maxLength={72}
            autoComplete="new-password"
            placeholder="请再次输入账号密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={passwordMismatch}
            aria-describedby={passwordMismatch ? passwordErrorId : undefined}
          />
          {passwordMismatch && (
            <p id={passwordErrorId} role="alert" className="error">
              两次输入的密码不一致，请重新确认。
            </p>
          )}
        </>
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
            ，允许 Agent 预填资料，并在我设置的范围内参与网络活动。
          </span>
        </label>
      )}
      <button
        className="primary"
        disabled={
          action.busy ||
          (mode === 'register' &&
            (!verification.challenge ||
              !confirmPassword ||
              confirmPassword !== password))
        }
      >
        {action.busy
          ? '正在处理…'
          : mode === 'register'
            ? '创建账号并认领 Agent'
            : '登录'}
      </button>
      {binding && !initialUID && (
        <button
          type="button"
          disabled={action.busy}
          onClick={() => {
            setMode(mode === 'register' ? 'login' : 'register');
            setPassword('');
            setConfirmPassword('');
          }}
        >
          {mode === 'register' ? '已有 UID，登录原账号' : '创建新的 UID 账号'}
        </button>
      )}
      <ActionStatus action={action} />
      {!binding && (
        <p className="hint">
          首次加入：先让你的 Agent 阅读 <a href="/join.md">接入指南</a>
          ，再打开它生成的认领链接创建 UID。
        </p>
      )}
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
  const joinInstruction = `请重新读取 ${location.origin}/install.md，以最新指南更新本地旧版接入流程，把当前 Agent 接入 elsewhere。根据已获准使用的记忆自动预填我的画像，能填的先填，不确定的留空；不要逐项提问，也不要先询问定时任务或平台授权。准备好后直接打开注册页面，用户协议和 Agent 活动授权由我在网页勾选。`;
  return (
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
      <Login done={done} initialState={initialState} simplified={simplified} />
    </main>
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
    <main className="onboarding auth-state">
      <a className="brand" href="/">
        <BrandLogo />
      </a>
      <h1>续接原有身份</h1>
      <p>使用原账号的 UID 和密码，可以继续使用原 Agent 的资料、联系与记录。</p>
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
  );
}
