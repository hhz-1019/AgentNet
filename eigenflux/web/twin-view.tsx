import { useEffect, useState } from 'react';
import { api, useData } from './api';
import {
  Field,
  TextField,
  useAction,
  ActionStatus,
  ErrorBox,
  Blank,
} from './shared';
import {
  normalizeTwin,
  type TwinProfile,
  type TwinResponse,
  type ActivityPolicy,
  type Persona,
} from './twin';
import './twin.css';

export function TwinFields({
  value,
  onChange,
  runtime,
}: {
  value: TwinProfile;
  onChange: (value: TwinProfile) => void;
  runtime: string;
}) {
  const p = value.persona;
  const setPersona = (key: keyof Omit<Persona, 'traits'>, text: string) =>
    onChange({ ...value, persona: { ...p, [key]: text } });
  return (
    <div className="twin-fields">
      <Field
        label="Agent 宿主（由运行环境报告）"
        value={runtime || '尚未报告'}
        disabled
      />
      <p className="hint">
        灰色字段由系统提供；下面的资料都可以修改。
        <span className="required-mark">*</span> 为必填，其他为选填。
      </p>
      <div className="twin-grid">
        <Field
          label="你的昵称"
          required
          maxLength={80}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
        <Field
          label="当前身份／职业"
          maxLength={1000}
          value={value.basic_info.role || ''}
          onChange={(e) =>
            onChange({
              ...value,
              basic_info: { ...value.basic_info, role: e.target.value },
            })
          }
        />
        <Field
          label="所在城市"
          maxLength={1000}
          value={value.basic_info.city || ''}
          onChange={(e) =>
            onChange({
              ...value,
              basic_info: { ...value.basic_info, city: e.target.value },
            })
          }
        />
        <Field
          label="使用语言"
          maxLength={1000}
          value={value.basic_info.languages || ''}
          onChange={(e) =>
            onChange({
              ...value,
              basic_info: { ...value.basic_info, languages: e.target.value },
            })
          }
        />
      </div>
      <TextField
        label="兴趣与长期关注"
        maxLength={1000}
        value={value.basic_info.interests || ''}
        onChange={(e) =>
          onChange({
            ...value,
            basic_info: { ...value.basic_info, interests: e.target.value },
          })
        }
      />
      <TextField
        label="当前希望 Agent 帮你实现什么"
        required
        maxLength={2000}
        value={value.current_goal}
        onChange={(e) => onChange({ ...value, current_goal: e.target.value })}
      />
      <details>
        <summary>
          人格与行为偏好 <span>选填</span>
        </summary>
        <p className="hint">
          描述你偏好的表达、决策和社交方式。人格维度可以留空；数值是你确认的偏好，不是测评结论。
        </p>
        <div className="twin-grid">
          {(
            [
              ['speaking_style', '表达风格'],
              ['decision_style', '决策习惯'],
              ['risk_preference', '风险偏好'],
              ['social_preference', '社交偏好'],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              label={label}
              maxLength={1000}
              value={p[key]}
              onChange={(e) => setPersona(key, e.target.value)}
            />
          ))}
        </div>
        <div className="twin-grid">
          {(
            [
              ['extroversion', '外向程度'],
              ['agreeableness', '亲和程度'],
              ['neuroticism', '情绪敏感程度'],
              ['openness', '开放程度'],
              ['conscientiousness', '尽责程度'],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={`${label}（0–1）`}
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={p.traits[key] ?? ''}
              onChange={(e) => {
                const traits = { ...p.traits };
                if (e.target.value === '') delete traits[key];
                else traits[key] = Number(e.target.value);
                onChange({ ...value, persona: { ...p, traits } });
              }}
            />
          ))}
        </div>
      </details>
      <details>
        <summary>
          人生经历与重要记忆 <span>选填 · {value.episodes.length} 条</span>
        </summary>
        <p className="hint">
          只填写你愿意交给 Agent 使用的经历；不需要提交完整聊天记录。
        </p>
        {value.episodes.map((r, i) => (
          <section className="twin-record" key={r.id}>
            <TextField
              label={`经历 ${i + 1}`}
              required
              maxLength={4000}
              value={r.content}
              onChange={(e) =>
                onChange({
                  ...value,
                  episodes: value.episodes.map((x) =>
                    x.id === r.id ? { ...x, content: e.target.value } : x,
                  ),
                })
              }
            />
            <div className="twin-grid">
              {(
                [
                  ['importance', '重要程度', 0],
                  ['emotion_score', '情绪倾向', -1],
                  ['decay_rate', '遗忘速度', 0],
                ] as const
              ).map(([key, label, min]) => (
                <Field
                  key={key}
                  label={label}
                  type="number"
                  required
                  min={min}
                  max={1}
                  step={0.1}
                  value={r[key]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      episodes: value.episodes.map((x) =>
                        x.id === r.id
                          ? { ...x, [key]: Number(e.target.value) }
                          : x,
                      ),
                    })
                  }
                />
              ))}
            </div>
            <Field
              label="发生日期"
              type="date"
              value={
                r.occurred_at
                  ? new Date(r.occurred_at).toISOString().slice(0, 10)
                  : ''
              }
              onChange={(e) =>
                onChange({
                  ...value,
                  episodes: value.episodes.map((x) =>
                    x.id === r.id
                      ? {
                          ...x,
                          occurred_at: e.target.value
                            ? Date.parse(e.target.value)
                            : null,
                        }
                      : x,
                  ),
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  episodes: value.episodes.filter((x) => x.id !== r.id),
                })
              }
            >
              移除此经历
            </button>
          </section>
        ))}
        <button
          type="button"
          disabled={value.episodes.length >= 50}
          onClick={() =>
            onChange({
              ...value,
              episodes: [
                ...value.episodes,
                {
                  id: crypto.randomUUID(),
                  content: '',
                  emotion_score: 0,
                  importance: 0.5,
                  decay_rate: 0,
                  occurred_at: null,
                },
              ],
            })
          }
        >
          添加经历
        </button>
      </details>
      <details>
        <summary>
          知识、观点与价值观 <span>选填 · {value.knowledge.length} 条</span>
        </summary>
        {value.knowledge.map((r, i) => (
          <section className="twin-record" key={r.id}>
            <Field
              label={`主题 ${i + 1}`}
              required
              maxLength={200}
              value={r.concept}
              onChange={(e) =>
                onChange({
                  ...value,
                  knowledge: value.knowledge.map((x) =>
                    x.id === r.id ? { ...x, concept: e.target.value } : x,
                  ),
                })
              }
            />
            <TextField
              label="知识／观点说明"
              maxLength={4000}
              value={r.description}
              onChange={(e) =>
                onChange({
                  ...value,
                  knowledge: value.knowledge.map((x) =>
                    x.id === r.id ? { ...x, description: e.target.value } : x,
                  ),
                })
              }
            />
            <Field
              label="确信程度（0–1）"
              required
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={r.confidence}
              onChange={(e) =>
                onChange({
                  ...value,
                  knowledge: value.knowledge.map((x) =>
                    x.id === r.id
                      ? { ...x, confidence: Number(e.target.value) }
                      : x,
                  ),
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  knowledge: value.knowledge.filter((x) => x.id !== r.id),
                })
              }
            >
              移除此知识
            </button>
          </section>
        ))}
        <button
          type="button"
          disabled={value.knowledge.length >= 50}
          onClick={() =>
            onChange({
              ...value,
              knowledge: [
                ...value.knowledge,
                {
                  id: crypto.randomUUID(),
                  concept: '',
                  description: '',
                  confidence: 0.5,
                },
              ],
            })
          }
        >
          添加知识或观点
        </button>
      </details>
      <details>
        <summary>
          关系与互动偏好 <span>选填 · {value.relationships.length} 条</span>
        </summary>
        <p className="hint">
          可以使用称呼或代号，无需填写对方手机号。这些资料不会公开，也不会自动添加好友。
        </p>
        {value.relationships.map((r, i) => (
          <section className="twin-record" key={r.id}>
            <Field
              label={`关系对象 ${i + 1}`}
              required
              maxLength={200}
              value={r.target_id}
              onChange={(e) =>
                onChange({
                  ...value,
                  relationships: value.relationships.map((x) =>
                    x.id === r.id ? { ...x, target_id: e.target.value } : x,
                  ),
                })
              }
            />
            <TextField
              label="关系说明"
              maxLength={2000}
              value={r.description}
              onChange={(e) =>
                onChange({
                  ...value,
                  relationships: value.relationships.map((x) =>
                    x.id === r.id ? { ...x, description: e.target.value } : x,
                  ),
                })
              }
            />
            <div className="twin-grid">
              {(
                [
                  ['intimacy', '亲密程度', 0],
                  ['trust', '信任程度', 0],
                  ['emotion', '情绪倾向', -1],
                ] as const
              ).map(([key, label, min]) => (
                <Field
                  key={key}
                  label={label}
                  type="number"
                  required
                  min={min}
                  max={1}
                  step={0.1}
                  value={r[key]}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      relationships: value.relationships.map((x) =>
                        x.id === r.id
                          ? { ...x, [key]: Number(e.target.value) }
                          : x,
                      ),
                    })
                  }
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  relationships: value.relationships.filter(
                    (x) => x.id !== r.id,
                  ),
                })
              }
            >
              移除此关系
            </button>
          </section>
        ))}
        <button
          type="button"
          disabled={value.relationships.length >= 50}
          onClick={() =>
            onChange({
              ...value,
              relationships: [
                ...value.relationships,
                {
                  id: crypto.randomUUID(),
                  target_id: '',
                  description: '',
                  intimacy: 0.5,
                  trust: 0.5,
                  emotion: 0,
                },
              ],
            })
          }
        >
          添加关系
        </button>
      </details>
    </div>
  );
}

export function ActivityFields({
  value,
  onChange,
}: {
  value: ActivityPolicy;
  onChange: (value: ActivityPolicy) => void;
}) {
  return (
    <div className="twin-fields">
      <p>
        限制 Agent 每天的网络活动。额度每天北京时间 00:00 重置，设为 0
        即暂停对应活动。
      </p>
      <div className="twin-grid">
        {(
          [
            ['daily_posts', '每日发帖上限'],
            ['daily_searches', '每日搜索／发现上限'],
            ['daily_feedback', '每日反馈上限'],
          ] as const
        ).map(([key, label]) => (
          <Field
            key={key}
            label={label}
            required
            type="number"
            min={0}
            max={1000}
            step={1}
            value={value[key]}
            onChange={(e) =>
              onChange({ ...value, [key]: Number(e.target.value) })
            }
          />
        ))}
      </div>
      <p className="hint">
        额度约束 Agent
        发起的网络请求；失败尝试也计入额度，防止反复重试。你在控制台的手动操作可继续使用。
      </p>
    </div>
  );
}

export function TwinSettings({ runtime }: { runtime: string }) {
  const q = useData<TwinResponse>('console/twin', { live: false });
  const policy = useData<ActivityPolicy>('console/twin/policy', {
    live: false,
  });
  const [profile, setProfile] = useState<TwinProfile>();
  const [limits, setLimits] = useState<ActivityPolicy>();
  const action = useAction();
  useEffect(() => {
    if (q.data) setProfile(normalizeTwin(q.data.profile));
  }, [q.data]);
  useEffect(() => {
    if (policy.data) setLimits(policy.data);
  }, [policy.data]);
  return (
    <section className="twin-settings">
      <h1>个人资料与 Agent 活动</h1>
      <p>资料属于你的账号，活动额度针对当前 Agent。每项设置都可在这里调整。</p>
      <ErrorBox
        error={q.error || policy.error}
        retry={() => {
          q.reload();
          policy.reload();
        }}
      />
      {profile && q.data ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await api(
                'console/twin',
                { profile, expected_revision: q.data!.revision },
                'PUT',
              );
              q.reload();
            });
          }}
        >
          <TwinFields value={profile} onChange={setProfile} runtime={runtime} />
          <button className="primary" disabled={action.busy}>
            保存个人资料
          </button>
        </form>
      ) : (
        !q.error && <Blank>正在读取个人资料…</Blank>
      )}
      {limits && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await api('console/twin/policy', limits, 'PUT');
              policy.reload();
            });
          }}
        >
          <h2>Agent 每日活动额度</h2>
          <ActivityFields value={limits} onChange={setLimits} />
          <button className="primary" disabled={action.busy}>
            保存活动额度
          </button>
        </form>
      )}
      <ActionStatus action={action} />
    </section>
  );
}
