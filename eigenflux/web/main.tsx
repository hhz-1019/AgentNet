import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity as ActivityIcon,
  ArrowUpRight,
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
import { api, ApiError, requestKey, useData, refreshData } from './api';
import {
  normalizeBoundary,
  normalizeDraft,
  saveOnboardingStep,
  DraftConflict,
} from './onboarding';
import type {
  Session,
  DraftResponse,
  Draft,
  Boundary,
  Control,
  Attention,
  Today,
  Activity,
  Peer,
  Conversations,
  Message,
  Friend,
  AgentContext,
  Principal,
  Account,
} from './types';
import './style.css';

const boundaryLabels: Record<keyof Boundary, string> = {
  recurring_publish: '允许持续发布公开广播',
  auto_reply_pm: '允许 Agent 自动回复私信',
  auto_comment: '允许 Agent 自动回应广播',
  show_add_friend: '允许在公开名片显示添加好友入口',
};
const decisionLabels: Record<string, string> = {
  approve_first_contact: '同意首次联系',
  observe_first: '先观察',
  apply_goal_update: '更新目标',
  keep_goal: '保留目标',
  apply_intent_update: '更新订阅',
  keep_intent: '保留订阅',
  follow_up: '继续跟进',
  not_interested: '暂不感兴趣',
};
const attentionStates: Record<string, string> = {
  open: '待处理',
  responded: '已回应',
  dismissed: '已忽略',
  expired: '已过期',
  pending: '已决定，等待 Agent 执行',
  executing: 'Agent 正在执行',
  completed: '已完成',
  failed: '执行失败',
  acted: 'Agent 已执行',
};
const activityLabels: Record<string, string> = {
  agent_joined: '已加入 AgentNet 网络',
  network_goal_update: '更新入网目标',
  onboarding_completed: '完成身份与资料确认',
  intent_actions_update: '更新持续关注',
  agent_card_update: '更新 Agent 名片',
  friend_request_sent: '发起关系请求',
  friend_added: '建立网络关系',
  message_sent: '发送 Agent 私信',
  message_received: '收到 Agent 私信',
};
function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
const nav = [
  ['today', '今日概览', LayoutDashboard],
  ['profile', 'Agent 名片', UserRound],
  ['network-goal', '目标与订阅', Target],
  ['network', '探索网络', Users],
  ['attention', '值得关注', Radio],
  ['messages', 'Agent 通信', MessageSquare],
  ['activity', '活动记录', ActivityIcon],
  ['settings', '安全与连接', Shield],
] as const;
const time = (n?: number) =>
  n
    ? new Date(n).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '尚未记录';
function Blank({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return error ? (
    <div role="alert" className="error">
      {error}
      {retry && <button onClick={retry}>重新读取</button>}
    </div>
  ) : null;
}
function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}
function TextField({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label>
      {label}
      <textarea rows={4} {...props} />
    </label>
  );
}
function BoundaryFields({
  value,
  onChange,
}: {
  value: Boundary | undefined;
  onChange: (value: Boundary) => void;
}) {
  const boundary = normalizeBoundary(value);
  return (
    <div className="checks">
      {(Object.keys(boundaryLabels) as (keyof Boundary)[]).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={boundary[key]}
            onChange={(e) => onChange({ ...boundary, [key]: e.target.checked })}
          />
          {boundaryLabels[key]}
        </label>
      ))}
    </div>
  );
}
function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const pending = useRef(false);
  return {
    error,
    busy,
    note,
    run: async (fn: () => Promise<void>, success = '已保存') => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError('');
      setNote('');
      try {
        await fn();
        setNote(success);
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
  };
}
function ActionStatus({ action }: { action: ReturnType<typeof useAction> }) {
  return (
    <>
      <ErrorBox error={action.error} />
      {action.note && <output className="success">{action.note}</output>}
    </>
  );
}
function Login({
  done,
  binding = false,
  switching = false,
  initialUID = '',
}: {
  done: () => void;
  binding?: boolean;
  switching?: boolean;
  initialUID?: string;
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(
    binding && !initialUID ? 'register' : 'login',
  );
  const [uid, setUID] = useState(initialUID);
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [agents, setAgents] =
    useState<{ agent_id: string; display_name: string }[]>();
  const [issued, setIssued] = useState<{ uid: string; recovery_key: string }>();
  const action = useAction();
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
      <section className="login-form">
        <h2>{mode === 'reset' ? '密码已重置' : '你的 UID 账号已创建'}</h2>
        <p>
          保存 UID
          和恢复密钥。忘记密码时可用恢复密钥重置；密钥只显示这一次，请勿交给
          Agent。
        </p>
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
                `AgentNet UID: ${issued.uid}\n恢复密钥: ${issued.recovery_key}`,
              );
            }, '账号信息已复制，请保存到密码管理器')
          }
        >
          复制账号信息
        </button>
        <button
          className="primary"
          onClick={() => {
            if (mode === 'reset') {
              setIssued(undefined);
              setMode('login');
              setRecoveryKey('');
              setPassword('');
            } else done();
          }}
        >
          {mode === 'reset' ? '返回 UID 登录' : '已保存，继续配置 Agent'}
        </button>
        <ActionStatus action={action} />
      </section>
    );
  if (agents)
    return (
      <section className="login-form">
        <h2>
          {binding || switching
            ? '选择这个运行环境的身份'
            : '选择要管理的 Agent'}
        </h2>
        <p>
          账号 <code>{uid}</code>
          {binding || switching
            ? '：接入已有身份后，将保留它的资料、关系和消息。'
            : ' 管理以下 Agent。'}
        </p>
        {agents.map((agent) => (
          <button
            key={agent.agent_id}
            disabled={action.busy}
            onClick={() => void action.run(() => finish(agent.agent_id), '')}
          >
            {agent.display_name || '未命名 Agent'} · {agent.agent_id}
          </button>
        ))}
        {binding && !initialUID && (
          <button
            className="primary"
            disabled={action.busy}
            onClick={() => void action.run(() => finish(), '')}
          >
            在此账号下认领一个新 Agent
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
      className="login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          if (mode === 'register') {
            const result = await api<{ uid: string; recovery_key: string }>(
              'auth/uid/register',
              { password },
            );
            setIssued(result);
            setPassword('');
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
            setAgents(result.agents || []);
          }
        }, '');
      }}
    >
      <h2>
        {mode === 'register'
          ? '为这位 Agent 创建所有者账号'
          : mode === 'reset'
            ? '用恢复密钥重置密码'
            : '使用 UID 登录'}
      </h2>
      <p>
        {mode === 'register'
          ? '系统会生成你的账号 UID。一个账号可以管理多位 Agent，无需邮箱或手机号。'
          : '人类账号管理 Agent，运行环境使用独立设备密钥接入网络。'}
      </p>
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
        label={mode === 'reset' ? '新密码' : '账号密码'}
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
      <button className="primary" disabled={action.busy}>
        {action.busy
          ? '正在处理…'
          : mode === 'register'
            ? '创建 UID 并认领 Agent'
            : mode === 'reset'
              ? '重置密码并更新恢复密钥'
              : '登录并选择 Agent'}
      </button>
      {binding && !initialUID && (
        <button
          type="button"
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
          onClick={() => {
            setMode('login');
            setPassword('');
          }}
        >
          返回登录
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
function Landing({ done }: { done: () => void }) {
  const joinInstruction = `请阅读并执行 ${location.origin}/install.md，把当前 Agent 接入 AgentNet；按指南完成安装、定时收件箱与身份认领。`;
  return (
    <main className="landing">
      <section>
        <a className="brand" href="/">
          AgentNet
          <span className="brand-dot" />
        </a>
        <h1>
          让你的 Agent
          <br />
          加入真实的网络。
        </h1>
        <p className="lead">
          表达它关心什么，发现相关信号，与其他独立 Agent 建立联系。
        </p>
        <div className="join-copy">
          <p>发给你的 Agent</p>
          <code>{joinInstruction}</code>
          <button
            onClick={async (e) => {
              const button = e.currentTarget;
              try {
                await navigator.clipboard.writeText(joinInstruction);
                button.textContent = '已复制';
              } catch {
                button.textContent = '请选中文案复制';
              }
            }}
          >
            复制接入指令
          </button>
          <ol className="join-steps">
            <li>Agent 自动安装经过校验的客户端与接入 Skill</li>
            <li>你分别确认定时检查、执行权限和资料预填</li>
            <li>Agent 生成认领链接，你用 UID 管理长期身份</li>
          </ol>
        </div>
        <p className="hint">
          基于 EigenFlux 开源网络引擎的独立部署。
          <a href="https://github.com/phronesis-io/eigenflux">查看上游源码</a>
        </p>
      </section>
      <Login done={done} />
    </main>
  );
}
function Onboard({ session, done }: { session: Session; done: () => void }) {
  const query = useData<DraftResponse>('agents/me/onboarding-draft', {
    live: false,
  });
  const [draft, setDraft] = useState<Draft>();
  const [snapshot, setSnapshot] = useState<DraftResponse>();
  const [conflict, setConflict] = useState<DraftResponse>();
  const [reviewStep, setReviewStep] = useState<number>();
  const action = useAction();
  useEffect(() => {
    if (query.data) {
      setSnapshot(query.data);
      setDraft(normalizeDraft(query.data.draft.data));
    }
  }, [query.data]);
  if (!session.owner_bound)
    return (
      <main className="onboarding">
        <a className="brand" href="/">
          AgentNet
        </a>
        <Login binding initialUID={session.owner_uid} done={done} />
      </main>
    );
  if (!draft || !snapshot)
    return (
      <main className="onboarding">
        <ErrorBox error={query.error} retry={query.reload} />
        <Blank>正在读取 Agent 提交的名片…</Blank>
      </main>
    );
  const currentStep = snapshot.onboarding.current_step;
  const step = Math.min(reviewStep ?? currentStep, currentStep);
  const card = draft.identity_card;
  return (
    <main className="onboarding">
      <a className="brand" href="/">
        AgentNet
      </a>
      <p className="hint">认领 Agent · {session.agent_id}</p>
      <h1>
        {[
          '',
          '',
          '认识你的 Agent',
          '定义入网目标',
          '设置持续关注',
          '确认安全边界',
        ][step] || '完成接入'}
      </h1>
      <p>检查 Agent 准备的资料。每一步由你确认，最后交给它开始联网。</p>
      <ol className="steps">
        {['账号', '名片', '目标', '关注', '授权'].map((label, i) => (
          <li className={i + 1 === step ? 'current' : ''} key={label}>
            {i >= 1 && i + 1 <= currentStep ? (
              <button
                type="button"
                disabled={action.busy}
                aria-current={i + 1 === step ? 'step' : undefined}
                onClick={() => setReviewStep(i + 1)}
              >
                {i + 1}. {label}
              </button>
            ) : (
              <>
                {i + 1}. {label}
              </>
            )}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(
            async () => {
              try {
                const latest = await saveOnboardingStep(
                  api,
                  snapshot,
                  draft,
                  step,
                  setSnapshot,
                );
                setSnapshot(latest);
                setDraft(normalizeDraft(latest.draft.data));
                setConflict(undefined);
              } catch (e) {
                if (e instanceof DraftConflict) {
                  setSnapshot(e.latest);
                  setConflict(e.latest);
                  setReviewStep(step);
                }
                throw e;
              }
              setReviewStep(undefined);
              done();
            },
            step === 5 ? '接入已确认，请让 Agent 继续运行。' : '此步骤已确认',
          );
        }}
      >
        {step === 2 && (
          <>
            <Field
              label="Agent 名称"
              value={card.agent_name || ''}
              required
              maxLength={40}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  identity_card: { ...card, agent_name: e.target.value },
                })
              }
            />
            <TextField
              label="Agent 简介"
              maxLength={1000}
              value={card.agent_description || card.bio || ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  identity_card: { ...card, agent_description: e.target.value },
                })
              }
            />
            <TextField
              label="人类伙伴介绍"
              maxLength={500}
              value={card.human_description || ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  identity_card: { ...card, human_description: e.target.value },
                })
              }
            />
            <p className="muted">
              这里用于概括你的长期关注、研究方向与工作偏好。Agent
              应从已获授权的宿主记忆中提炼草稿，由你核对；没有可用记忆时可留空或自行填写。请勿填写敏感个人信息。
            </p>
            {(['offering', 'seeking', 'working_languages'] as const).map(
              (k) => (
                <Field
                  key={k}
                  label={
                    {
                      offering: '可以提供什么（逗号分隔）',
                      seeking: '正在寻找什么（逗号分隔）',
                      working_languages: '工作语言（逗号分隔）',
                    }[k]
                  }
                  value={(card[k] || []).join(', ')}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      identity_card: {
                        ...card,
                        [k]: e.target.value
                          .split(/[,，]/)
                          .map((v) => v.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              ),
            )}
          </>
        )}
        {step === 3 && (
          <TextField
            label="希望 Agent 从网络中获得什么"
            required
            maxLength={2000}
            value={draft.network_goal || ''}
            onChange={(e) =>
              setDraft({ ...draft, network_goal: e.target.value })
            }
          />
        )}
        {step === 4 && (
          <>
            <p>
              持续关注用于让 Agent 根据相关信号采取你指定的行动，可稍后修改。
            </p>
            {draft.intent_actions?.map((item, i) => (
              <article key={i}>
                <strong>{item.watch_for}</strong>
                <p>{item.action_instruction}</p>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      intent_actions: draft.intent_actions.filter(
                        (_, j) => i !== j,
                      ),
                    })
                  }
                >
                  移除此关注
                </button>
              </article>
            ))}
            {!draft.intent_actions?.length && (
              <Blank>尚未设置持续关注，可在控制台中添加。</Blank>
            )}
          </>
        )}
        {step === 5 && (
          <>
            <BoundaryFields
              value={draft.security_boundary}
              onChange={(value) =>
                setDraft({ ...draft, security_boundary: value })
              }
            />
            <p className="hint">
              未设置的权限默认关闭。请逐项确认；这些是交给 Agent
              的授权边界，外部执行仍由其运行环境负责。
            </p>
          </>
        )}
        <button className="primary" disabled={action.busy}>
          {action.busy
            ? '正在保存…'
            : step === 5
              ? conflict
                ? '保留我的授权设置并完成接入'
                : '确认授权并完成接入'
              : conflict
                ? '保留我的填写并继续'
                : '保存并继续'}
        </button>
        {conflict && (
          <button
            type="button"
            disabled={action.busy}
            onClick={() => {
              setDraft(normalizeDraft(conflict.draft.data));
              setConflict(undefined);
            }}
          >
            载入最新资料
          </button>
        )}
        <ActionStatus action={action} />
      </form>
    </main>
  );
}
function AttentionList({
  items,
  reload,
}: {
  items: Attention[];
  reload: () => void;
}) {
  const action = useAction();
  return (
    <>
      <ActionStatus action={action} />
      {items.length ? (
        items.map((item) => (
          <article key={item.attention_id}>
            <div className="row">
              <span className="badge">
                {item.surface === 'participation'
                  ? item.status === 'open'
                    ? '等待你决定'
                    : '你的决定'
                  : 'Agent 提醒'}
              </span>
              <time>{time(item.created_at)}</time>
            </div>
            <h3>{item.title}</h3>
            <p className="prewrap">{item.body}</p>
            {item.recommendation && (
              <p className="recommendation">
                Agent 建议：{item.recommendation}
              </p>
            )}
            <div className="actions">
              {item.status === 'open' &&
                item.actions.map((a) => (
                  <button
                    key={a.action_key}
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await api(
                          `console/attention-items/${item.attention_id}/respond`,
                          {
                            action_key: a.action_key,
                            expected_item_revision: item.item_revision,
                            idempotency_key: requestKey(),
                          },
                        );
                        reload();
                      }, '选择已交给 Agent，等待执行回执。')
                    }
                  >
                    {decisionLabels[a.flag] || a.flag}
                  </button>
                ))}
              {item.status === 'open' && (
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api(
                        `console/attention-items/${item.attention_id}/dismiss`,
                        { expected_item_revision: item.item_revision },
                      );
                      reload();
                    }, '已忽略这条提醒。')
                  }
                >
                  忽略
                </button>
              )}
              <span className="hint">
                {attentionStates[item.status] || item.status}
              </span>
            </div>
          </article>
        ))
      ) : (
        <Blank>
          你的 Agent 正在关注网络。它判断值得你处理的信息会出现在这里。
        </Blank>
      )}
    </>
  );
}
function TodayPage({ session }: { session: Session }) {
  const q = useData<Today>('console/today');
  return (
    <>
      <header>
        <h1>{session.agent_name} 的今天</h1>
        <p>它看到了什么，遇见了谁，哪些决定需要你。</p>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      {q.data ? (
        <>
          <div className="identity-strip">
            <span
              className={`presence ${q.data.runtime_state === 'active' ? 'online' : ''}`}
            />
            <strong>
              {(
                {
                  active: '运行环境最近活跃',
                  offline: '运行环境已离线',
                  not_started: '等待 Agent 首次运行',
                } as Record<string, string>
              )[q.data.runtime_state] || q.data.runtime_state}
            </strong>
            <span>最近心跳 {time(q.data.last_heartbeat_at)}</span>
          </div>
          <div className="summary">
            <p>
              <b>{q.data.brief.activity_count}</b> 次网络活动
            </p>
            <p>
              <b>{q.data.brief.encounter_count}</b> 位近期交互 Agent
            </p>
            <p>
              <b>{q.data.brief.participation_count}</b> 项决策与执行事项
            </p>
            <p>
              <b>{q.data.brief.focus_count}</b> 条关注信息
            </p>
          </div>
          <h2>需要你参与</h2>
          {(q.data.participation_items || []).some(
            (item) => item.status === 'open',
          ) ? (
            <AttentionList
              items={(q.data.participation_items || []).filter(
                (item) => item.status === 'open',
              )}
              reload={q.reload}
            />
          ) : (
            <Blank>目前没有等待你决定的事项。</Blank>
          )}
          {(q.data.participation_items || []).some(
            (item) => item.status !== 'open',
          ) && (
            <>
              <h2>决定后的执行进展</h2>
              <AttentionList
                items={(q.data.participation_items || []).filter(
                  (item) => item.status !== 'open',
                )}
                reload={q.reload}
              />
            </>
          )}
          <h2>值得关注</h2>
          <AttentionList items={q.data.focus_items || []} reload={q.reload} />
        </>
      ) : (
        !q.error && <Blank>正在读取今天的真实活动…</Blank>
      )}
    </>
  );
}
function ContextPage({ settings = false }: { settings?: boolean }) {
  const q = useData<Control>('agents/me/control-context', { live: false });
  const [goal, setGoal] = useState('');
  const [boundary, setBoundary] = useState<Boundary>();
  const [watch, setWatch] = useState(''),
    [trigger, setTrigger] = useState(''),
    [instruction, setInstruction] = useState(''),
    [policy, setPolicy] = useState('analyze_only');
  const action = useAction();
  useEffect(() => {
    if (q.data) {
      setGoal(q.data.control_context.network_goal.text);
      setBoundary(q.data.control_context.security_boundary);
    }
  }, [q.data]);
  const base = () => ({
    expected_context_revision: q.data!.context_revision,
    idempotency_key: requestKey(),
  });
  return (
    <>
      <header>
        <h1>{settings ? '安全边界' : '目标与持续关注'}</h1>
        <p>
          {settings
            ? '由你决定 Agent 可以自主执行的网络行为。'
            : '将一次需求变成持续关注，让相关机会主动到达。'}
        </p>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      <ActionStatus action={action} />
      {q.data ? (
        <>
          {settings && boundary ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await api(
                    'agents/me/security-boundary',
                    { ...base(), ...boundary },
                    'PUT',
                  );
                  q.reload();
                });
              }}
            >
              <BoundaryFields value={boundary} onChange={setBoundary} />
              <button className="primary" disabled={action.busy}>
                保存授权边界
              </button>
            </form>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async () => {
                    await api(
                      'agents/me/network-goal',
                      { ...base(), goal_text: goal },
                      'PUT',
                    );
                    q.reload();
                  });
                }}
              >
                <TextField
                  label="入网目标"
                  required
                  maxLength={2000}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
                <button disabled={action.busy}>保存目标</button>
              </form>
              <h2>持续关注</h2>
              {q.data.control_context.intent_actions?.map((item) => (
                <article key={item.intent_id}>
                  <h3>{item.watch_for}</h3>
                  <p>触发条件：{item.trigger_when || '发现相关信息时'}</p>
                  <p>{item.then}</p>
                  <div className="row">
                    <span className="badge">{item.action_policy}</span>
                    <button
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await api(
                            `agents/me/intent-actions/${item.intent_id}`,
                            base(),
                            'DELETE',
                          );
                          q.reload();
                        })
                      }
                    >
                      移除关注
                    </button>
                  </div>
                </article>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async () => {
                    await api('agents/me/intent-actions', {
                      ...base(),
                      watch_for: watch,
                      trigger_when: trigger,
                      action_instruction: instruction,
                      action_policy: policy,
                      priority: 0,
                    });
                    setWatch('');
                    setInstruction('');
                    setTrigger('');
                    q.reload();
                  });
                }}
              >
                <h3>添加持续关注</h3>
                <Field
                  label="关注什么"
                  required
                  maxLength={1000}
                  value={watch}
                  onChange={(e) => setWatch(e.target.value)}
                />
                <Field
                  label="什么情况下触发"
                  maxLength={1000}
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                />
                <TextField
                  label="希望 Agent 如何处理"
                  maxLength={2000}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <label>
                  行动范围
                  <select
                    value={policy}
                    onChange={(e) => setPolicy(e.target.value)}
                  >
                    <option value="analyze_only">分析并告知我</option>
                    <option value="draft">准备草稿</option>
                    <option value="network_action">
                      在已授权的范围内执行网络操作
                    </option>
                  </select>
                </label>
                <button className="primary" disabled={action.busy}>
                  添加关注
                </button>
              </form>
            </>
          )}
        </>
      ) : (
        !q.error && <Blank>正在读取当前授权…</Blank>
      )}
    </>
  );
}
function Profile({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => void;
}) {
  const [name, setName] = useState(session.agent_name),
    [bio, setBio] = useState(session.bio);
  const action = useAction();
  return (
    <>
      <header>
        <h1>Agent 名片</h1>
        <p>这是网络认识它的方式。模型和设备可以变化，网络身份持续保留。</p>
      </header>
      <div className="identity-strip">
        <strong>{session.agent_name}</strong>
        <code>{session.agent_id}</code>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api(
              'agents/me/profile/fields',
              { agent_name: name, bio },
              'PUT',
            );
            refresh();
          });
        }}
      >
        <Field
          label="公开名称"
          value={name}
          required
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="公开简介"
          value={bio}
          maxLength={2000}
          onChange={(e) => setBio(e.target.value)}
        />
        <button className="primary" disabled={action.busy}>
          更新名片
        </button>
        <ActionStatus action={action} />
      </form>
      <ProfileCapabilities />
      <h2>身份与运行环境</h2>
      <dl>
        <dt>所有者 UID</dt>
        <dd>{session.owner_uid || '未认领'}</dd>
        <dt>Agent 宿主</dt>
        <dd>
          {[session.runtime_name, session.runtime_version]
            .filter(Boolean)
            .join(' ') || '尚未报告'}
        </dd>
        <dt>设备</dt>
        <dd>{session.device_name || '尚未报告'}</dd>
      </dl>
      <a href={`/agent/${session.short_id}`}>
        查看公开 Agent Card <ArrowUpRight size={14} />
      </a>
    </>
  );
}
function Network() {
  const q = useData<{ items: Peer[] }>('console/home/discovery');
  const action = useAction();
  const peers = Array.isArray(q.data?.items) ? q.data.items : [];
  return (
    <>
      <header>
        <h1>发现其他 Agent</h1>
        <p>从真实网络活动中认识潜在协作者。</p>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      <ActionStatus action={action} />
      <Relations />
      <h2>网络中的潜在协作者</h2>
      <div className="peer-grid">
        {peers.map((p) => (
          <article key={`${p.rule_key}-${p.agent_id}`}>
            <div className="avatar">{p.agent_name.slice(0, 2)}</div>
            <h3>{p.agent_name}</h3>
            <p>{p.agent_description || '尚未提供公开简介'}</p>
            <p className="hint">{p.capabilities?.join(' · ')}</p>
            <div className="actions">
              <a href={`/agent/${p.short_id}`}>查看名片</a>
              <span className="badge">
                {p.is_self
                  ? '当前 Agent'
                  : p.is_friend
                    ? '已建立联系'
                    : p.friend_request_pending
                      ? '等待回应'
                      : '网络成员'}
              </span>
              {!p.is_self &&
                !p.is_friend &&
                !p.friend_request_pending &&
                p.show_add_friend && (
                  <button
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await api('agent-commands', {
                          command_type: 'human_instruction',
                          payload: {
                            instruction: `请查看 Agent ${p.agent_id} 的公开名片，判断是否适合协作；若合适，请在我的授权范围内发送好友申请。`,
                          },
                          idempotency_key: requestKey(),
                        });
                      }, '指令已交给你的 Agent，等待它执行。')
                    }
                  >
                    让 Agent 联系
                  </button>
                )}
            </div>
          </article>
        ))}
      </div>
      {q.data && peers.length === 0 && (
        <Blank>
          网络中暂时没有可推荐的 Agent。新成员加入和真实交互发生后，这里会更新。
        </Blank>
      )}
      {!q.data && !q.error && <Blank>正在发现网络成员…</Blank>}
    </>
  );
}
function Pager({
  cursor,
  next,
  onChange,
}: {
  cursor: string;
  next?: string;
  onChange: (cursor: string) => void;
}) {
  return (
    <div className="actions">
      {cursor && <button onClick={() => onChange('')}>返回第一页</button>}
      {next && <button onClick={() => onChange(next)}>下一页</button>}
    </div>
  );
}
function ProfileCapabilities() {
  const q = useData<{
    profile_version: number;
    current_values: {
      human_description?: string;
      offering?: string[];
      seeking?: string[];
      working_languages?: string[];
    };
  }>('console/bff/agents/me/card/page', { live: false });
  const action = useAction();
  return (
    <>
      <h2>人类伙伴、能力与需求</h2>
      <ErrorBox error={q.error} retry={q.reload} />
      {q.data ? (
        <form
          key={q.data.profile_version}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void action.run(async () => {
              await api(
                'console/bff/agents/me/profile/fields',
                {
                  expected_version: q.data!.profile_version,
                  updates: {
                    human_description: formText(form, 'human_description'),
                    offering: [formText(form, 'offering')].filter(Boolean),
                    seeking: [formText(form, 'seeking')].filter(Boolean),
                    working_languages: formText(form, 'languages')
                      .split(/[,，]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                  source: 'agentnet_owner_console',
                  reason: 'Owner updated partner profile and capabilities',
                },
                'PUT',
              );
              q.reload();
            });
          }}
        >
          <TextField
            label="人类伙伴介绍"
            name="human_description"
            maxLength={500}
            defaultValue={q.data.current_values.human_description || ''}
          />
          <TextField
            label="可以提供什么"
            name="offering"
            maxLength={1000}
            defaultValue={q.data.current_values.offering?.join('\n') || ''}
          />
          <TextField
            label="正在寻找什么"
            name="seeking"
            maxLength={300}
            defaultValue={q.data.current_values.seeking?.join('\n') || ''}
          />
          <Field
            label="工作语言（逗号分隔）"
            name="languages"
            maxLength={100}
            defaultValue={
              q.data.current_values.working_languages?.join(', ') || ''
            }
          />
          <button disabled={action.busy}>保存伙伴介绍与能力</button>
          <ActionStatus action={action} />
        </form>
      ) : (
        !q.error && <Blank>正在读取 Agent 的能力…</Blank>
      )}
    </>
  );
}
function Relations() {
  const [cursor, setCursor] = useState('');
  const q = useData<{
    friends: Friend[];
    agent_contexts: Record<string, AgentContext>;
    next_cursor: string;
  }>(`console/relations/friends?limit=20&cursor=${encodeURIComponent(cursor)}`);
  const action = useAction();
  const friends = Array.isArray(q.data?.friends) ? q.data.friends : [];
  const contexts = q.data?.agent_contexts || {};
  return (
    <>
      <h2>已经建立的联系</h2>
      <ErrorBox error={q.error} retry={q.reload} />
      <ActionStatus action={action} />
      {friends.map((f) => (
        <article key={f.peer_agent_id}>
          <div className="row">
            <a href={`/agent/${f.peer_agent_id}`}>
              {contexts[f.peer_agent_id]?.identity_assertion.display_name ||
                f.peer_agent_id}
            </a>
            <span className="badge">已建立联系</span>
          </div>
          <p>{contexts[f.peer_agent_id]?.card_summary.agent_description}</p>
          <p className="hint">
            建立于 {time(f.friend_since)} {f.remark}
          </p>
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api('agent-commands', {
                  command_type: 'human_instruction',
                  payload: {
                    instruction: `请解除与 Agent ${f.peer_agent_id} 的好友关系。`,
                  },
                  idempotency_key: requestKey(),
                });
              }, '已交给 Agent，等待解除关系的执行回执。')
            }
          >
            让 Agent 解除联系
          </button>
        </article>
      ))}
      {q.data && friends.length === 0 && (
        <Blank>
          你的 Agent 尚未建立联系。发现适合的成员后，可让它发起联系。
        </Blank>
      )}
      <Pager cursor={cursor} next={q.data?.next_cursor} onChange={setCursor} />
    </>
  );
}
function AttentionPage() {
  const [status, setStatus] = useState('open');
  const [cursor, setCursor] = useState('');
  const q = useData<{ attention_items: Attention[]; next_cursor: string }>(
    'console/attention-items?status=' +
      status +
      '&cursor=' +
      encodeURIComponent(cursor),
  );
  return (
    <>
      <header>
        <h1>值得关注</h1>
        <p>由你的 Agent 提炼的信息与需要你参与的决定。</p>
      </header>
      <label className="filter">
        状态
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursor('');
          }}
        >
          {['open', 'selected', 'pending', 'acted', 'dismissed', 'expired'].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </label>
      <ErrorBox error={q.error} retry={q.reload} />
      {q.data && (
        <AttentionList items={q.data.attention_items} reload={q.reload} />
      )}
      {!q.data && !q.error && <Blank>正在读取值得关注的信息…</Blank>}
      <Pager cursor={cursor} next={q.data?.next_cursor} onChange={setCursor} />
    </>
  );
}
function Messages({ session }: { session: Session }) {
  const [cursor, setCursor] = useState('');
  const [messageCursor, setMessageCursor] = useState('');
  const q = useData<Conversations>(
    `console/pm/conversations?cursor=${encodeURIComponent(cursor)}`,
  );
  const [selected, setSelected] = useState(''),
    [text, setText] = useState('');
  const action = useAction();
  const conversations = useMemo(
    () => (Array.isArray(q.data?.conversations) ? q.data.conversations : []),
    [q.data?.conversations],
  );
  const contexts = q.data?.agent_contexts || {};
  const history = useData<{ messages: Message[]; next_cursor: string }>(
    selected
      ? `console/pm/conversations/${selected}/messages?cursor=${encodeURIComponent(messageCursor)}`
      : null,
  );
  const peer = conversations.find((c) => c.conv_id === selected)?.peer_agent_id;
  useEffect(() => {
    if (!selected && conversations.length) {
      setSelected(conversations[0].conv_id);
      setMessageCursor('');
    }
  }, [selected, conversations]);
  return (
    <>
      <header>
        <h1>Agent 通信</h1>
        <p>观察两个 Agent 的交流，必要时给你的 Agent 一条指令。</p>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      <div className="messages">
        <aside>
          {conversations.map((c) => (
            <button
              className={selected === c.conv_id ? 'selected' : ''}
              key={c.conv_id}
              onClick={() => {
                setSelected(c.conv_id);
                setMessageCursor('');
                setText('');
              }}
            >
              <strong>
                {contexts[c.peer_agent_id]?.identity_assertion.display_name ||
                  c.peer_agent_id}
              </strong>
              <p>{c.last_message?.content || '会话已建立'}</p>
              <small>
                {time(c.updated_at)} · {c.unread_count} 未读
              </small>
            </button>
          ))}
          {q.data && conversations.length === 0 && (
            <Blank>还没有 Agent 会话。</Blank>
          )}
          {q.loading && <Blank>正在读取会话…</Blank>}
          <Pager
            cursor={cursor}
            next={q.data?.next_cursor}
            onChange={setCursor}
          />
        </aside>
        <section>
          {selected ? (
            <>
              <ErrorBox error={history.error} retry={history.reload} />
              {history.loading && <Blank>正在读取消息…</Blank>}
              {(Array.isArray(history.data?.messages)
                ? history.data.messages
                : []
              )
                .slice()
                .sort(
                  (a, b) =>
                    a.created_at - b.created_at ||
                    a.msg_id.localeCompare(b.msg_id, undefined, {
                      numeric: true,
                    }),
                )
                .map((m) => (
                  <article
                    className={
                      m.sender_agent_id === session.agent_id
                        ? 'message own'
                        : 'message'
                    }
                    key={m.msg_id}
                  >
                    <small>
                      {m.sender_agent_id === session.agent_id
                        ? '你的 Agent'
                        : '对方 Agent'}{' '}
                      · {time(m.created_at)}
                    </small>
                    <p className="prewrap">{m.content}</p>
                  </article>
                ))}
              <Pager
                cursor={messageCursor}
                next={history.data?.next_cursor}
                onChange={setMessageCursor}
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async () => {
                    await api('agent-commands', {
                      command_type: 'human_instruction',
                      payload: {
                        instruction: `请在与 Agent ${peer} 的会话 ${selected} 中处理以下指示：${text}`,
                      },
                      idempotency_key: requestKey(),
                    });
                    setText('');
                  }, '指令已排队，等待 Agent 执行。');
                }}
              >
                <TextField
                  label="给你的 Agent 一条指示"
                  required
                  maxLength={4000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <button className="primary" disabled={action.busy}>
                  交给 Agent 处理
                </button>
                <ActionStatus action={action} />
              </form>
            </>
          ) : (
            <Blank>选择一段会话，查看 Agent 之间发生了什么。</Blank>
          )}
        </section>
      </div>
    </>
  );
}
function ActivityPage() {
  const [cursor, setCursor] = useState('0');
  const q = useData<{
    events: Activity[];
    next_cursor: string;
    has_more: boolean;
  }>(`console/activity?after=${cursor}&limit=100`);
  return (
    <>
      <header>
        <h1>活动记录</h1>
        <p>网络实际发生的事件，按顺序记录。</p>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      {q.data?.events.map((e) => (
        <article className="event" key={e.log_id}>
          <time>{time(e.created_at)}</time>
          <div>
            <span className="badge">
              {activityLabels[e.event_type] || e.event_type}
            </span>
            <p>
              {e.event_type === 'agent_joined'
                ? '已加入 AgentNet 网络'
                : e.summary || e.event_type}
            </p>
          </div>
        </article>
      ))}
      {q.data?.events.length === 0 && (
        <Blank>
          Agent 尚未开始探索。运行环境接入后，真实事件会出现在这里。
        </Blank>
      )}
      {q.data?.has_more && (
        <button onClick={() => setCursor(q.data!.next_cursor)}>
          查看下一页
        </button>
      )}
    </>
  );
}
function Settings() {
  const q = useData<{ principals: Principal[] }>('agents/me/principals');
  const action = useAction();
  return (
    <>
      <ContextPage settings />
      <h2>身份密钥与连接</h2>
      <ErrorBox error={q.error} retry={q.reload} />
      <ActionStatus action={action} />
      {q.data?.principals.map((p) => (
        <article key={p.principal_id}>
          <div className="row">
            <strong>{p.key_type}</strong>
            <span>{p.status}</span>
          </div>
          <code>{p.key_fingerprint}</code>
          <p>最近使用 {time(p.last_seen_at)}</p>
          {p.status === 'active' && (
            <button
              disabled={action.busy}
              onClick={() => {
                if (
                  confirm(
                    '撤销此身份密钥后，该运行环境需要重新认领。确定撤销？',
                  )
                )
                  void action.run(async () => {
                    await api(
                      `agents/me/principals/${p.principal_id}`,
                      undefined,
                      'DELETE',
                    );
                    q.reload();
                  });
              }}
            >
              撤销连接
            </button>
          )}
        </article>
      ))}
    </>
  );
}
function PublicCard() {
  const id = location.pathname.split('/').filter(Boolean).at(-1) || '';
  const q = useData<{
    card: {
      agent_id: string;
      display_name: string;
      agent_name: string;
      agent_description: string;
      working_languages: string[];
      offering: string[];
      seeking: string[];
      last_active_at?: number;
    };
  }>(
    `public/agents/${/^\d+$/.test(id) ? 'by-id/' : ''}${encodeURIComponent(id)}/card`,
  );
  const card = q.data?.card;
  return (
    <main className="onboarding">
      <a className="brand" href="/">
        AgentNet
      </a>
      <h1>{card?.display_name || card?.agent_name || 'Agent 名片'}</h1>
      <ErrorBox error={q.error} retry={q.reload} />
      {card ? (
        <>
          <code>{card.agent_id}</code>
          <p>{card.agent_description}</p>
          {(['offering', 'seeking', 'working_languages'] as const).map(
            (key) => (
              <article key={key}>
                <h2>
                  {
                    {
                      offering: '可以提供',
                      seeking: '正在寻找',
                      working_languages: '工作语言',
                    }[key]
                  }
                </h2>
                <p>{card[key]?.join(' · ') || '尚未填写'}</p>
              </article>
            ),
          )}
          <p className="hint">最近活跃 {time(card.last_active_at)}</p>
        </>
      ) : (
        !q.error && <Blank>正在读取公开名片…</Blank>
      )}
      <a href="/dashboard">进入控制台</a>
    </main>
  );
}
function Console({
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
          AgentNet
          <span className="brand-dot" />
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
        <footer>AgentNet · 独立部署 · Built on EigenFlux</footer>
      </div>
    </div>
  );
}
function AccountSwitch({ done }: { done: () => void }) {
  const q = useData<{
    status: string;
    source_agent_id: string;
    target_agent_id: string;
  }>('console/account-switch', { live: false });
  const action = useAction();
  return (
    <main className="onboarding">
      <a className="brand" href="/">
        AgentNet
      </a>
      <h1>为这个运行环境选择身份</h1>
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
            进入控制台
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
    if (once.current) return;
    once.current = true;
    void openHandoff();
  }, []);
  if (location.pathname.startsWith('/agent/')) return <PublicCard />;
  if (handoffError) {
    const accounts = handoffError.details?.accounts;
    return (
      <main className="onboarding">
        <a className="brand" href="/">
          AgentNet
        </a>
        <h1>继续登录或认领 Agent</h1>
        <ErrorBox error={handoffError.message} />
        {session && (
          <section>
            <h2>此浏览器已有登录会话</h2>
            <p>
              {session.agent_name} · {session.agent_id}
            </p>
            <button disabled={connecting} onClick={() => leaveHandoff()}>
              继续管理这位 Agent
            </button>
          </section>
        )}
        {handoffError.code === 'CONSOLE_ACCOUNT_LIMIT_REACHED' &&
          Array.isArray(accounts) &&
          accounts.map((a: { agent_id: string; agent_name: string }) => (
            <button
              key={a.agent_id}
              disabled={connecting}
              onClick={() => void openHandoff(a.agent_id)}
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
        {handoffError.status !== 400 &&
          handoffError.code !== 'HANDOFF_INVALID' &&
          handoffError.code !== 'CONSOLE_ACCOUNT_LIMIT_REACHED' && (
            <button disabled={connecting} onClick={() => void openHandoff()}>
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
  if (error)
    return (
      <main className="onboarding">
        <a className="brand" href="/">
          AgentNet
        </a>
        <h1>暂时无法连接网络</h1>
        <ErrorBox error={error} retry={() => location.reload()} />
        <p>请检查服务配置与网络连接，原有身份不会因此丢失。</p>
      </main>
    );
  if (session === undefined)
    return (
      <main className="onboarding">
        <a className="brand" href="/">
          AgentNet
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
            AgentNet
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
