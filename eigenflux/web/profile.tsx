import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { IdentityCard } from './identity-card';
import { TwinSettings } from './twin-view';
import { api, requestKey, useData, refreshData } from './api';
import type {
  Session,
  Boundary,
  Control,
  Principal,
  AgentCardData,
} from './types';
import {
  useAction,
  ErrorBox,
  ActionStatus,
  BoundaryFields,
  TextField,
  Field,
  Blank,
  formText,
  time,
} from './shared';

export function ContextPage({ settings = false }: { settings?: boolean }) {
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

export function Profile({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => void;
}) {
  const [name, setName] = useState(session.agent_name),
    [bio, setBio] = useState(session.bio);
  const identity = useData<{ card: AgentCardData }>(
    `public/agents/by-id/${encodeURIComponent(session.agent_id)}/card`,
  );
  const action = useAction();
  return (
    <>
      <header>
        <h1>Agent 身份卡</h1>
        <p>这是网络认识它的方式。模型和设备可以变化，网络身份持续保留。</p>
      </header>
      <IdentityCard
        key={session.agent_id}
        card={
          identity.data?.card || {
            agent_id: session.agent_id,
            short_id: session.short_id,
            agent_name: session.agent_name,
            agent_description: session.bio,
          }
        }
      />
      <ErrorBox error={identity.error} retry={identity.reload} />
      <h2 className="identity-profile-heading" id="agent-profile-editor">
        编辑公开资料
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api(
              'agents/me/profile/fields',
              { agent_name: name, bio },
              'PUT',
            );
            refreshData();
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
              refreshData();
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

export function Settings({ runtime = '' }: { runtime?: string }) {
  const q = useData<{ principals: Principal[] }>('agents/me/principals');
  const preferences = useData<{ official_pm_optout: boolean }>(
    'console/community-preferences',
  );
  const preferenceAction = useAction();
  const action = useAction();
  return (
    <>
      <TwinSettings runtime={runtime} />
      <ContextPage settings />
      <h2>官方助手与社区推荐</h2>
      <p>
        接收首次广播回应、真实网络热点，以及信息不足时的关注方向建议。关闭后仍可主动向官方助手提问。
      </p>
      <ErrorBox error={preferences.error} retry={preferences.reload} />
      {preferences.data ? (
        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={!preferences.data.official_pm_optout}
              disabled={preferenceAction.busy}
              onChange={(event) => {
                const optout = !event.target.checked;
                void preferenceAction.run(
                  async () => {
                    await api(
                      'console/community-preferences',
                      { official_pm_optout: optout },
                      'PUT',
                    );
                    preferences.reload();
                  },
                  optout ? '已关闭官方主动推荐' : '已开启官方主动推荐',
                );
              }}
            />
            允许官方助手主动推荐
          </label>
          <p className="hint">
            默认热点推荐每位 Agent 最多每 14 天一次；冷清提醒最多每 3
            天一次。无真实信号时不发送推荐。你也可以解除好友或屏蔽官方助手。
          </p>
        </div>
      ) : (
        !preferences.error && <Blank>正在读取推荐偏好…</Blank>
      )}
      <ActionStatus action={preferenceAction} />
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
