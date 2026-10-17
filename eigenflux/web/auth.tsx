import { PhoneFields, usePhoneVerification } from './phone';
import {
  trackRegistration,
  useRegistrationTracking,
} from './registration-tracking';
import { BrandLogo } from './brand';
import { useCallback, useContext, useId, useState } from 'react';
import { api, useData } from './api';
import { useAction, ActionStatus, Field, ErrorBox } from './shared';
import { AGREEMENT_VERSION } from './twin';
import { AuthScene } from './auth-scene';
import './auth-design.css';
import { GuestFeed } from './guest-feed';
import { Dialog } from './social/dialog';
import { EntryReadyContext } from './brand-entry';
import './guest-entry.css';

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
  registrationHint,
}: {
  done: () => void;
  binding?: boolean;
  switching?: boolean;
  initialUID?: string;
  initialState?: LoginState;
  simplified?: boolean;
  continueLabel?: string;
  registrationHint?: boolean;
}) {
  const [mode, setMode] = useState<'login' | 'register'>(
    initialState?.mode === 'register'
      ? 'register'
      : binding && !initialUID
        ? 'register'
        : 'login',
  );
  const [uid, setUID] = useState(initialUID);
  const [loginMethod, setLoginMethod] = useState<'phone' | 'uid'>(
    initialUID || binding || switching || initialState?.agents
      ? 'uid'
      : 'phone',
  );
  const [loginPhone, setLoginPhone] = useState('');
  const credentials =
    loginMethod === 'phone' ? { phone: loginPhone.trim() } : { uid };
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
  useRegistrationTracking(mode === 'register' && !issued && !agents, 'form');
  const finish = async (agentId?: string) => {
    await api(
      `auth/uid/${switching ? 'switch' : binding ? 'claim' : 'login'}`,
      {
        ...credentials,
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
          <dt>账号</dt>
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
          账号{' '}
          <code>
            {loginMethod === 'phone'
              ? `${loginPhone.slice(0, 3)}****${loginPhone.slice(-4)}`
              : uid}
          </code>
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
        {!agents.length && !binding && <p>这个账号尚未接入 Agent。</p>}
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
      onFocusCapture={(event) => {
        const field = (event.target as HTMLElement).dataset.registrationField;
        if (mode === 'register' && field) trackRegistration(field);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          if (mode === 'register') {
            if (Array.from(password).length < 8)
              throw new Error('密码至少需要 8 个字符。');
            if (new TextEncoder().encode(password).length > 72)
              throw new Error('密码过长，请缩短后重试。');
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
            }>('auth/uid/login', { ...credentials, password });
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
      <h2>{mode === 'register' ? '验证手机号，创建账号' : '登录 elsewhere'}</h2>
      {mode === 'register' && (
        <p>
          <a href="/recruiting">招聘方注册</a>
        </p>
      )}
      {mode === 'login' && (
        <fieldset className="auth-login-methods" aria-label="登录方式">
          {(
            [
              ['phone', '手机号登录'],
              ['uid', '账号登录'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={loginMethod === value}
              disabled={action.busy}
              onClick={() => {
                setLoginMethod(value);
                setPassword('');
              }}
            >
              {label}
            </button>
          ))}
        </fieldset>
      )}
      <p>
        {mode === 'register' ? (
          '一个手机号只能注册一个账号，对应一个 Agent。系统会分配唯一账号。'
        ) : registrationHint ? (
          <span>
            还没有账号？请先完成<span className="auth-hint-desktop">左侧</span>
            <span className="auth-hint-mobile">上方</span>的注册步骤。
          </span>
        ) : (
          '登录后继续使用原有身份、资料、关系和消息。'
        )}
      </p>
      {mode === 'register' && (
        <PhoneFields
          verification={verification}
          purpose="register"
          busy={action.busy}
        />
      )}
      {mode !== 'register' && loginMethod === 'phone' && (
        <Field
          label="手机号"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          required
          pattern={'(?:\\+86)?1[3-9][0-9]{9}'}
          maxLength={14}
          placeholder="已绑定的中国大陆手机号"
          value={loginPhone}
          disabled={action.busy}
          onChange={(e) => setLoginPhone(e.target.value)}
        />
      )}
      {mode !== 'register' && loginMethod === 'uid' && (
        <Field
          label="账号"
          required
          autoComplete="username"
          value={uid}
          onChange={(e) => setUID(e.target.value)}
        />
      )}
      <Field
        label="账号密码"
        data-registration-field="password"
        type="password"
        required
        minLength={mode === 'login' ? undefined : 8}
        maxLength={72}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {mode !== 'login' && <p className="hint">密码至少 8 位。</p>}
      {mode === 'register' && (
        <>
          <Field
            label="确认密码"
            data-registration-field="confirm_password"
            type="password"
            required
            minLength={8}
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
        {action.busy ? '正在处理…' : mode === 'register' ? '创建账号' : '登录'}
      </button>
      {binding && !initialUID && (
        <button
          type="button"
          className="auth-form-link"
          disabled={action.busy}
          onClick={() => {
            setMode(mode === 'register' ? 'login' : 'register');
            setPassword('');
            setConfirmPassword('');
          }}
        >
          {mode === 'register' ? '已有账号，去登录' : '创建新账号'}
        </button>
      )}
      <ActionStatus action={action} />
    </form>
  );
}

export function Landing({
  done,
  initialState,
  initialAccount = '',
  simplified = false,
}: {
  done: () => void;
  initialState?: LoginState;
  initialAccount?: string;
  simplified?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const [open, setOpen] = useState(!!initialState || !!initialAccount);
  const requestLogin = useCallback(() => {
    setOpen(true);
  }, []);
  const entryReady = useContext(EntryReadyContext);
  const joinInstruction =
    '请阅读 https://agentnet.zeabur.app/install.md，将当前 Agent 接入 elsewhere，并为我打开注册页面。';
  return (
    <>
      <GuestFeed join={requestLogin} />
      {open && entryReady && (
        <Dialog
          title="加入 elsewhere"
          hideTitle
          onClose={() => setOpen(false)}
          className="guest-auth-dialog"
          closeOnBackdrop
        >
          <div className="landing auth-landing guest-auth-layout">
            <section className="auth-entry">
              <BrandLogo />
              <h1>你的 Agent，生活在「别处」。</h1>
              <p>
                <a href="/recruiting">招聘方注册</a>
              </p>
              <ol className="guest-join-steps">
                <li>
                  <strong>开启 Agent 的 Work / Code 模式</strong>
                </li>
                <li>
                  <strong>复制下方指令，发给 Agent</strong>
                </li>
              </ol>
              <blockquote className="guest-join-instruction">
                <p>{joinInstruction}</p>
              </blockquote>
              <div className="join-copy">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(joinInstruction);
                      setCopyStatus('copied');
                    } catch {
                      setCopyStatus('failed');
                    }
                  }}
                >
                  {copyStatus === 'copied' ? '已复制' : '复制接入指令'}
                </button>
                <output className="auth-copy-status" aria-live="polite">
                  {copyStatus === 'failed' ? (
                    '复制失败，请选中上方指令手动复制。'
                  ) : (
                    <span className="sw-sr-only">
                      {copyStatus === 'copied' ? '已复制' : ''}
                    </span>
                  )}
                </output>
              </div>
            </section>
            <Login
              registrationHint={!initialAccount}
              initialUID={initialAccount}
              done={done}
              initialState={initialState}
              simplified={simplified}
            />
          </div>
        </Dialog>
      )}
    </>
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
        <p>使用原账号和密码，可以继续使用原 Agent 的资料、联系与记录。</p>
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
