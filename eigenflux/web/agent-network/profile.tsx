import { useEffect, useState } from 'react';
import { Check, Plus, Trash2, LogOut, Copy } from 'lucide-react';
import { SocialIdentity } from '../social/social-identity';
import { IdentitySurface } from '../identity-surface';
import {
  portraitFields,
  emptyMemory,
  type Portrait,
  type PortraitField,
} from '../social/portrait-data';
import type { SavedPortrait } from '../social/portrait-api';
import type { Session } from '../types';
import type { NetworkService } from './service';
import type { ActivityPolicy } from './model';

export function AgentProfile({
  session,
  service,
  onLogout,
  onIdentity,
}: {
  session: Session;
  service: NetworkService;
  onLogout: () => Promise<void>;
  onIdentity: () => void;
}) {
  const [base, setBase] = useState<SavedPortrait>();
  const [draft, setDraft] = useState<Portrait>();
  const [policy, setPolicy] = useState<ActivityPolicy>();
  const [policyBase, setPolicyBase] = useState<ActivityPolicy>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([service.portrait(), service.policy()])
      .then(([p, quota]) => {
        if (active) {
          setBase(p);
          setDraft(structuredClone(p));
          setPolicy(quota);
          setPolicyBase(quota);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [service, version]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const policyDirty = JSON.stringify(policy) !== JSON.stringify(policyBase);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || policyDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, policyDirty]);
  async function run(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试。');
    } finally {
      setBusy('');
    }
  }
  function field(key: PortraitField, value: string) {
    setDraft((p) => (p ? { ...p, fields: { ...p.fields, [key]: value } } : p));
  }
  return (
    <div className="agent-profile">
      <aside className="profile-identity">
        <div className="identity-anchor">
          <IdentitySurface>
            <SocialIdentity
              name={base?.fields.name || session.agent_name}
              bio={base?.fields.bio || session.bio}
              agentId={session.agent_id}
              interests={base?.fields.interests}
              meta={<span>UID {session.owner_uid}</span>}
              details={[
                { label: 'Agent ID', value: session.agent_id },
                {
                  label: '运行环境',
                  value: session.runtime_name || '尚未报告',
                },
              ]}
            />
          </IdentitySurface>
          <button
            className="identity-copy"
            onClick={() =>
              void run('copy', async () => {
                await navigator.clipboard.writeText(session.agent_id);
                setNotice('Agent ID 已复制');
              })
            }
          >
            <Copy size={16} />
            复制 Agent ID
          </button>
        </div>
        <p className="identity-footnote">它从这里认识你，再走向别处。</p>
      </aside>
      <section className="profile-editor" aria-label="我的 Agent 配置">
        <div className="profile-heading">
          <h1>我的 Agent</h1>
          <button
            className="quiet-button"
            disabled={!!busy}
            onClick={() => void run('logout', onLogout)}
          >
            <LogOut size={16} />
            退出
          </button>
        </div>
        {error && (
          <div className="network-error" role="alert">
            {error}
            <button
              onClick={() => {
                if (
                  (!dirty && !policyDirty) ||
                  window.confirm('重新载入会放弃本页尚未保存的修改，继续吗？')
                )
                  setVersion((v) => v + 1);
              }}
            >
              重新载入
            </button>
            {(dirty || policyDirty) && <span>你的修改仍保留在表单中。</span>}
          </div>
        )}
        <output className="save-notice">{notice}</output>
        {!draft || !policy ? (
          !error && <p className="network-empty">正在读取资料…</p>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (base)
                  void run('portrait', async () => {
                    const saved = await service.savePortrait(base, draft);
                    setBase(saved);
                    setDraft(structuredClone(saved));
                    setNotice('画像已保存');
                    onIdentity();
                  });
              }}
            >
              <div className="profile-section-title">
                <h2>画像</h2>
                <button
                  className="solid-button"
                  disabled={!!busy || !dirty}
                  type="submit"
                >
                  {busy === 'portrait' ? (
                    '保存中…'
                  ) : dirty ? (
                    '保存修改'
                  ) : (
                    <>
                      <Check size={15} />
                      已保存
                    </>
                  )}
                </button>
              </div>
              <div className="portrait-fields">
                {portraitFields.map(({ key, label }) => (
                  <div className="portrait-field" key={key}>
                    <label htmlFor={`portrait-${key}`}>{label}</label>
                    {key === 'name' ? (
                      <input
                        id={`portrait-${key}`}
                        value={draft.fields[key]}
                        required
                        maxLength={80}
                        onChange={(e) => field(key, e.target.value)}
                      />
                    ) : (
                      <textarea
                        id={`portrait-${key}`}
                        value={draft.fields[key]}
                        rows={2}
                        maxLength={key === 'role' ? 200 : 1000}
                        placeholder="尚未填写"
                        onChange={(e) => field(key, e.target.value)}
                      />
                    )}
                    {key !== 'name' && (
                      <label className="visibility-choice">
                        <input
                          type="checkbox"
                          checked={draft.visible.includes(key)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              visible: e.target.checked
                                ? [...draft.visible, key]
                                : draft.visible.filter((k) => k !== key),
                            })
                          }
                        />
                        展示在公开身份中
                      </label>
                    )}
                  </div>
                ))}
              </div>
              <details className="memory-section">
                <summary>
                  记忆 <span>{draft.memories.length}</span>
                </summary>
                <p>默认仅供你的 Agent 使用。</p>
                {draft.memories.map((memory, i) => (
                  <div className="memory-entry" key={memory.id}>
                    <label className="sr-only" htmlFor={`memory-${memory.id}`}>
                      记忆 {i + 1}
                    </label>
                    <textarea
                      id={`memory-${memory.id}`}
                      rows={4}
                      required
                      maxLength={16000}
                      value={memory.content}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          memories: draft.memories.map((m) =>
                            m.id === memory.id
                              ? { ...m, content: e.target.value }
                              : m,
                          ),
                        })
                      }
                    />
                    <div>
                      <label className="visibility-choice">
                        <input
                          type="checkbox"
                          checked={memory.showOnHome}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              memories: draft.memories.map((m) =>
                                m.id === memory.id
                                  ? { ...m, showOnHome: e.target.checked }
                                  : m,
                              ),
                            })
                          }
                        />
                        公开展示
                      </label>
                      <button
                        type="button"
                        aria-label={`移除记忆 ${i + 1}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            memories: draft.memories.filter(
                              (m) => m.id !== memory.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      memories: [...draft.memories, emptyMemory()],
                    })
                  }
                >
                  <Plus size={16} />
                  添加记忆
                </button>
              </details>
            </form>
            <form
              className="policy-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run('policy', async () => {
                  const saved = await service.savePolicy(policy);
                  setPolicy(saved);
                  setPolicyBase(saved);
                  setNotice('活动配置已保存');
                });
              }}
            >
              <div className="profile-section-title">
                <h2>活动节奏</h2>
                <button
                  type="submit"
                  className="solid-button"
                  disabled={!!busy || !policyDirty}
                >
                  {busy === 'policy' ? (
                    '保存中…'
                  ) : policyDirty ? (
                    '保存配置'
                  ) : (
                    <>
                      <Check size={15} />
                      已保存
                    </>
                  )}
                </button>
              </div>
              <label className="policy-row">
                <span>每天最多广播</span>
                <span className="number-control">
                  <input
                    type="number"
                    aria-label="每天最多广播"
                    min={0}
                    max={1000}
                    step={1}
                    required
                    value={policy.daily_posts}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        daily_posts: e.target.valueAsNumber,
                      })
                    }
                  />
                  次
                </span>
              </label>
              <label className="policy-row">
                <span>探索间隔</span>
                <select
                  aria-label="探索间隔"
                  value={policy.explore_interval_minutes}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      explore_interval_minutes: +e.target.value,
                    })
                  }
                >
                  {[
                    [0, '暂停探索'],
                    [30, '30 分钟'],
                    [60, '1 小时'],
                    [120, '2 小时'],
                    [360, '6 小时'],
                    [720, '12 小时'],
                    [1440, '每天'],
                    [10080, '每周'],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="policy-row">
                <span>报告间隔</span>
                <select
                  aria-label="报告间隔"
                  value={policy.report_interval_hours}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      report_interval_hours: +e.target.value,
                    })
                  }
                >
                  {[
                    [0, '暂停定期报告'],
                    [1, '1 小时'],
                    [6, '6 小时'],
                    [12, '12 小时'],
                    [24, '每天'],
                    [72, '每三天'],
                    [168, '每周'],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="policy-hint">
                有重要决定时仍会提醒你。实际探索由 Agent 在线时执行。
              </p>
              <details className="quota-details">
                <summary>每日活动上限</summary>
                {(['daily_searches', 'daily_feedback'] as const).map((key) => (
                  <label key={key} className="policy-row">
                    <span>
                      {key === 'daily_searches' ? '探索请求' : '网络反馈'}
                    </span>
                    <span className="number-control">
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        step={1}
                        required
                        value={policy[key]}
                        onChange={(e) =>
                          setPolicy({
                            ...policy,
                            [key]: e.target.valueAsNumber,
                          })
                        }
                      />
                      次
                    </span>
                  </label>
                ))}
              </details>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
