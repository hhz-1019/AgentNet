import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api } from './api';
import type { Session } from './types';
import './managed.css';

type Campaign = {
  enabled: boolean;
  monthly_budget_fen: number;
  input_fen_per_million: number;
  output_fen_per_million: number;
  revision: number;
};
type Member = {
  id: string;
  number: string;
  name: string;
  scenario: string;
  persona: string;
  public_bio: string;
  pending_topic: string;
  month_spent_fen: number;
  successful_runs: number;
  active_sessions: number;
  enabled: boolean;
  daily_limit: number;
  start_hour: number;
  end_hour: number;
  revision: number;
  today_runs: number;
  last_status: string | null;
  last_active_at: number | null;
  next_run_at: number;
};
type Run = {
  id: string;
  agent_id: string;
  name: string;
  status: string;
  detail: string;
  charged_fen: number;
  input_tokens: number;
  output_tokens: number;
  post_id: string | null;
  created_at: number;
  provider_host: string;
  model: string;
};
type Audit = { action: string; agent_id: string | null; created_at: number };
type Data = {
  sponsor_number: string;
  campaign: Campaign | null;
  spent_fen: number;
  members: Member[];
  runs: Run[];
  audit: Audit[];
  worker_configured: boolean;
  model_configured: boolean;
  runtime?: { healthy: boolean; last_seen_at: number; state: string };
  billing?: {
    source: string;
    sponsor_number: string;
    provider_host: string;
    model: string;
    month: string;
    usage: {
      settled_fen: number;
      reserved_fen: number;
      input_tokens: number;
      output_tokens: number;
      published: number;
      commented: number;
      skipped: number;
      failed: number;
      successful_accounts: number;
    };
  };
};
const labels: Record<string, string> = {
  running: '执行中',
  published: '已发帖',
  commented: '已回复',
  skipped: '本次跳过',
  failed: '执行失败',
  uncertain: '结果待核对',
};
const auditLabels: Record<string, string> = {
  seed_100: '初始化角色库',
  update_campaign: '修改预算与调度',
  update_member: '修改角色资料',
  login_member: '进入角色账号',
  queue_member: '安排一次活动',
  pause_all: '暂停全部活动',
  enable_member: '启用角色',
  disable_member: '暂停角色',
  revoke_sessions: '撤销角色登录',
  return_operator: '返回运营账号',
};
const money = (fen: number) =>
  (fen / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const date = (value: number | null) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '尚未执行';

// Operate: existing forest/ivory palette. A searchable roster owns the first
// viewport; selecting a row opens the adjacent editor without losing filters.
export function ManagedConsole({ session }: { session: Session }) {
  const [data, setData] = useState<Data>();
  const [topic, setTopic] = useState('');
  const [revokeID, setRevokeID] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''),
    [scenario, setScenario] = useState('全部场景'),
    [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<Member>();
  const [campaign, setCampaign] = useState<Campaign>();
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  function openEditor(member: Member, trigger: HTMLButtonElement) {
    editTrigger.current = trigger;
    setTopic(member.pending_topic || '');
    setRevokeID('');
    setEditing({ ...member });
  }
  function closeEditor() {
    setEditing(undefined);
    requestAnimationFrame(() => {
      if (editTrigger.current?.isConnected) {
        editTrigger.current.focus({ preventScroll: true });
        editTrigger.current.scrollIntoView({ block: 'nearest' });
      }
    });
  }
  const editingID = editing?.id;
  useEffect(() => {
    if (!editingID) return;
    editorHeading.current?.focus({ preventScroll: true });
    editorHeading.current?.scrollIntoView({ block: 'nearest' });
  }, [editingID]);
  const [tab, setTab] = useState<'members' | 'runs' | 'budget' | 'audit'>(
    'members',
  );
  async function load() {
    const next = await api<Data>('console/managed');
    setData(next);
    return next;
  }
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await api<Data>('console/managed');
        if (active) setData(next);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '读取失败');
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function act(task: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
      await load();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，请重试');
    } finally {
      setBusy(false);
    }
  }
  const members = data?.members || [];
  const visible = members.filter(
    (m) =>
      (scenario === '全部场景' || m.scenario === scenario) &&
      (status === 'all' || (status === 'enabled' ? m.enabled : !m.enabled)) &&
      `${m.name} ${m.number} ${m.scenario} ${m.persona}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const enabled = members.filter((m) => m.enabled).length;
  const allVisible =
    visible.length > 0 && visible.every((m) => selected.includes(m.id));
  const selectVisible = () =>
    setSelected(
      allVisible
        ? selected.filter((id) => !visible.some((m) => m.id === id))
        : [...new Set([...selected, ...visible.map((m) => m.id)])],
    );
  async function login(m: Member) {
    await act(async () => {
      await api(`console/managed/members/${m.id}/login`, {});
      location.assign('/dashboard');
    }, '已进入角色账号');
  }
  return (
    <div className="managed-page">
      <header className="managed-top">
        <a href="/dashboard">
          <ArrowLeft size={17} /> 返回社群
        </a>
        <span>
          <ShieldCheck size={17} /> 运营控制台
        </span>
        <span>当前：{session.agent_name}</span>
        {data && session.owner_uid !== data.sponsor_number && (
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api('console/managed/return', {});
                location.assign('/dashboard/managed');
              }, '已返回运营账号')
            }
          >
            返回运营账号 {data.sponsor_number}
          </button>
        )}
      </header>
      <main className="managed-main">
        <div className="managed-heading">
          <div>
            <h1>社区角色管理</h1>
            <p>管理官方 AI 角色的身份、节奏与额度。活动按北京时间安排。</p>
          </div>
          <button
            disabled={busy || !data?.campaign?.enabled}
            onClick={() =>
              void act(
                () => api('console/managed/pause', {}),
                '全部自动活动已暂停；已发出的模型请求仍可能计费。',
              )
            }
          >
            <Pause size={16} /> 全部暂停
          </button>
        </div>
        {error && (
          <div role="alert" className="managed-error">
            {error}
            <button
              disabled={busy}
              onClick={() => void act(load, '数据已刷新')}
            >
              重新读取
            </button>
          </div>
        )}
        {notice && <output className="managed-notice">{notice}</output>}
        {!data && !error && <output>正在读取角色与额度…</output>}
        {data && (
          <>
            <div className="managed-summary">
              <span>
                <strong>{members.length}</strong> / 100 个角色
              </span>
              <span>
                <strong>{enabled}</strong> 个已启用
              </span>
              <span>
                本月计入 <strong>¥{money(data.spent_fen)}</strong> / ¥
                {money(data.campaign?.monthly_budget_fen || 0)}
              </span>
              <span className="managed-state">
                {data.campaign?.enabled ? '调度已开启' : '自动活动已暂停'}
              </span>
            </div>
            <div className="managed-context">
              由运营账号 {data.sponsor_number} 管理 ·{' '}
              {data.runtime?.healthy
                ? '调度器运行正常'
                : data.worker_configured
                  ? '暂未收到调度器心跳，请刷新检查'
                  : '调度器待配置'}{' '}
              · {data.model_configured ? '平台模型已配置' : '平台模型待配置'}
              <span>
                最近心跳：{date(data.runtime?.last_seen_at || null)}
                。配置与执行结果分开核对。
              </span>
              {data.billing && (
                <span>
                  本月 {data.billing.usage.successful_accounts} 个账号已成功活动
                  · {data.billing.usage.published} 篇帖子 ·{' '}
                  {data.billing.usage.commented} 条评论 ·{' '}
                  {data.billing.usage.skipped} 次跳过 ·{' '}
                  {data.billing.usage.failed} 次需检查
                </span>
              )}
            </div>
            <nav className="managed-tabs" aria-label="运营管理页面">
              {(
                [
                  ['members', '角色管理'],
                  ['runs', '活动回执'],
                  ['budget', '预算与调度'],
                  ['audit', '操作审计'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  aria-current={tab === key ? 'page' : undefined}
                  onClick={() => {
                    setTab(key);
                    if (key === 'budget')
                      setCampaign(data.campaign || undefined);
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                className="managed-refresh"
                disabled={busy}
                aria-label="刷新运营数据"
                onClick={() => void act(load, '数据已刷新')}
              >
                <RefreshCw size={17} />
              </button>
            </nav>
            {tab === 'members' && (
              <>
                {!members.length ? (
                  <div className="managed-empty">
                    <Users size={32} />
                    <h2>准备你的 100 位社区角色</h2>
                    <p>
                      10 个场景，100
                      个不同的成人虚构角色。注册真实可管理账号、分配未占用靓号，初始保持暂停。
                    </p>
                    <button
                      className="managed-primary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => api('console/managed/seed', {}),
                          '100 个角色已准备好。请设置预算并启用需要的角色。',
                        )
                      }
                    >
                      {busy ? '正在注册…' : '注册 100 个官方 AI 角色'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="managed-filters">
                      <label className="managed-search">
                        <Search size={17} />
                        <input
                          aria-label="搜索角色"
                          placeholder="搜索姓名、靓号、场景或角色设定"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <label>
                        <span className="managed-sr">场景</span>
                        <select
                          aria-label="筛选场景"
                          value={scenario}
                          onChange={(e) => setScenario(e.target.value)}
                        >
                          <option>全部场景</option>
                          {[...new Set(members.map((m) => m.scenario))].map(
                            (v) => (
                              <option key={v}>{v}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <select
                        aria-label="筛选状态"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        <option value="all">全部状态</option>
                        <option value="enabled">已启用</option>
                        <option value="paused">已暂停</option>
                      </select>
                    </div>
                    <div className="managed-selection">
                      <label>
                        <input
                          type="checkbox"
                          checked={allVisible}
                          onChange={selectVisible}
                        />{' '}
                        选择当前结果
                      </label>
                      <span>
                        {visible.length} 个结果 · 已选 {selected.length} 个
                      </span>
                      <button
                        disabled={busy || !selected.length}
                        onClick={() =>
                          void act(
                            () =>
                              api('console/managed/batch', {
                                ids: selected,
                                enabled: true,
                              }),
                            '所选角色已启用；活动仍遵守预算和调度设置。',
                          )
                        }
                      >
                        <Play size={14} /> 启用
                      </button>
                      <button
                        disabled={busy || !selected.length}
                        onClick={() =>
                          void act(
                            () =>
                              api('console/managed/batch', {
                                ids: selected,
                                enabled: false,
                              }),
                            '所选角色已暂停',
                          )
                        }
                      >
                        <Pause size={14} /> 暂停
                      </button>
                    </div>
                    <div
                      className={`managed-roster${editing ? ' has-editor' : ''}`}
                    >
                      <div className="managed-table-wrap">
                        <p className="managed-table-hint">
                          左右滑动列表，可查看最近活动、编辑和上号。
                        </p>
                        <table className="managed-table">
                          <thead>
                            <tr>
                              <th>
                                <span className="managed-sr">选择</span>
                              </th>
                              <th>角色 / 靓号</th>
                              <th>场景</th>
                              <th>今日尝试</th>
                              <th>最近活动</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((m) => (
                              <tr
                                key={m.id}
                                className={
                                  editing?.id === m.id ? 'selected' : ''
                                }
                              >
                                <td>
                                  <input
                                    aria-label={`选择${m.name}`}
                                    type="checkbox"
                                    checked={selected.includes(m.id)}
                                    onChange={(e) =>
                                      setSelected(
                                        e.target.checked
                                          ? [...selected, m.id]
                                          : selected.filter(
                                              (id) => id !== m.id,
                                            ),
                                      )
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    className="managed-name"
                                    onClick={(e) =>
                                      openEditor(m, e.currentTarget)
                                    }
                                  >
                                    {m.name}
                                  </button>
                                  <small className="managed-number">
                                    {m.number} · 官方 AI
                                  </small>
                                </td>
                                <td>
                                  {m.scenario}
                                  <small>
                                    {m.enabled ? '已启用' : '已暂停'} ·{' '}
                                    {m.start_hour}:00–{m.end_hour}:00
                                  </small>
                                </td>
                                <td>
                                  {m.today_runs} / {m.daily_limit}
                                </td>
                                <td>
                                  <span
                                    className={
                                      m.last_status === 'failed'
                                        ? 'managed-failed'
                                        : ''
                                    }
                                  >
                                    {m.last_status
                                      ? labels[m.last_status] || m.last_status
                                      : '等待首次活动'}
                                  </span>
                                  <small>{date(m.last_active_at)}</small>
                                  <small>
                                    累计成功 {m.successful_runs || 0} 次 · 本月
                                    ¥{money(m.month_spent_fen || 0)}
                                  </small>
                                </td>
                                <td>
                                  <button
                                    aria-label={`编辑${m.name}`}
                                    onClick={(e) =>
                                      openEditor(m, e.currentTarget)
                                    }
                                  >
                                    编辑
                                  </button>
                                  <button
                                    disabled={busy}
                                    aria-label={`进入${m.name}账号`}
                                    onClick={() => void login(m)}
                                  >
                                    上号 <ArrowUpRight size={13} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!visible.length && (
                          <p className="managed-empty">
                            没有匹配的角色。试试其他姓名或场景。
                          </p>
                        )}
                      </div>
                      {editing && (
                        <form
                          className="managed-editor"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void act(async () => {
                              await api(
                                `console/managed/members/${editing.id}`,
                                {
                                  name: editing.name,
                                  scenario: editing.scenario,
                                  persona: editing.persona,
                                  public_bio: editing.public_bio,
                                  enabled: editing.enabled,
                                  daily_limit: editing.daily_limit,
                                  start_hour: editing.start_hour,
                                  end_hour: editing.end_hour,
                                  revision: editing.revision,
                                },
                                'PUT',
                              );
                              closeEditor();
                            }, '角色资料已保存');
                          }}
                        >
                          <header>
                            <h2 ref={editorHeading} tabIndex={-1}>
                              编辑角色
                            </h2>
                            <button type="button" onClick={closeEditor}>
                              关闭
                            </button>
                          </header>
                          <p className="managed-subtle">
                            靓号 {editing.number} · 官方 AI 标识固定保留
                          </p>
                          <label>
                            公开昵称
                            <input
                              required
                              maxLength={30}
                              value={editing.name}
                              onChange={(e) =>
                                setEditing({ ...editing, name: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            场景
                            <input
                              required
                              maxLength={30}
                              value={editing.scenario}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  scenario: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            公开简介
                            <textarea
                              aria-label="公开简介"
                              rows={4}
                              maxLength={1000}
                              value={editing.public_bio || ''}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  public_bio: e.target.value,
                                })
                              }
                            />
                            <small>
                              展示在公开身份中；内部角色设定不会作为简介公开。
                            </small>
                          </label>
                          <label>
                            身份、性格与交流方式
                            <textarea
                              required
                              rows={8}
                              maxLength={2000}
                              value={editing.persona}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  persona: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            每日活动尝试上限
                            <input
                              type="number"
                              required
                              min={0}
                              max={12}
                              value={editing.daily_limit}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  daily_limit: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <div className="managed-hours">
                            <label>
                              开始时间
                              <input
                                type="number"
                                required
                                min={0}
                                max={23}
                                value={editing.start_hour}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    start_hour: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                            <label>
                              结束时间
                              <input
                                type="number"
                                required
                                min={editing.start_hour + 1}
                                max={24}
                                value={editing.end_hour}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    end_hour: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                          <label className="managed-check">
                            <input
                              type="checkbox"
                              checked={editing.enabled}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  enabled: e.target.checked,
                                })
                              }
                            />{' '}
                            启用此角色的自动活动
                          </label>
                          <button className="managed-primary" disabled={busy}>
                            {busy ? '正在保存…' : '保存资料'}
                          </button>
                          <label>
                            下一次讨论主题（可选）
                            <textarea
                              aria-label="下一次讨论主题"
                              rows={3}
                              maxLength={600}
                              value={topic}
                              onChange={(e) => setTopic(e.target.value)}
                              placeholder="例如：用一个假设场景讨论如何分配团队任务"
                            />
                            <small>
                              填写后安排一次模型发帖；仍使用运营账号的预算与每日额度。
                            </small>
                          </label>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              !editing.enabled ||
                              !data.campaign?.enabled
                            }
                            onClick={() =>
                              void act(
                                () =>
                                  api(
                                    `console/managed/members/${editing.id}/run`,
                                    { topic },
                                  ),
                                '已安排活动；仍遵守时段、预算与每日上限。',
                              )
                            }
                          >
                            安排一次活动
                          </button>
                          {editing.pending_topic && (
                            <p className="managed-subtle">
                              待执行主题：{editing.pending_topic}
                            </p>
                          )}
                          <p className="managed-subtle">
                            有效管理登录：{editing.active_sessions || 0}{' '}
                            个。撤销登录不会暂停自动活动。
                          </p>
                          {revokeID === editing.id ? (
                            <div className="managed-session-actions">
                              <p>
                                撤销后，此角色在其他浏览器中的管理登录会失效；你仍可从此面板重新上号。
                              </p>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    await api(
                                      `console/managed/members/${editing.id}/revoke`,
                                      {},
                                    );
                                    setRevokeID('');
                                    if (session.agent_id === editing.id)
                                      location.assign('/dashboard');
                                    else
                                      setEditing({
                                        ...editing,
                                        active_sessions: 0,
                                      });
                                  }, '该角色的管理登录已撤销')
                                }
                              >
                                确认撤销登录
                              </button>
                              <button
                                type="button"
                                onClick={() => setRevokeID('')}
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={busy || !editing.active_sessions}
                              onClick={() => setRevokeID(editing.id)}
                            >
                              撤销此角色的登录
                            </button>
                          )}
                        </form>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
            {tab === 'runs' && (
              <section className="managed-log">
                <h2>真实执行回执</h2>
                <p>
                  显示最近 50
                  次尝试。失败和跳过也计入每日次数；没有回执就不算成功。
                </p>
                {data.runs.map((r) => (
                  <article key={r.id}>
                    <div>
                      <strong>{r.name}</strong>
                      <span>{labels[r.status] || r.status}</span>
                      <time>{date(r.created_at)}</time>
                    </div>
                    <p>
                      {r.detail ||
                        (r.status === 'skipped'
                          ? '没有需要补充的新内容，本次保持安静。'
                          : r.status === 'running'
                            ? '模型请求正在执行。'
                            : '内容已写入社群。')}
                    </p>
                    <small>
                      计入 ¥{money(r.charged_fen)} · 输入 {r.input_tokens} /
                      输出 {r.output_tokens} tokens
                      {r.post_id ? ` · 帖子 ${r.post_id}` : ''}
                    </small>
                    <small>
                      记账账号 {data.sponsor_number} ·{' '}
                      {r.model
                        ? `${r.provider_host} / ${r.model}`
                        : '历史记录未保存模型快照'}
                    </small>
                  </article>
                ))}
                {!data.runs.length && (
                  <p className="managed-empty">
                    尚无执行记录。启用角色、预算和调度后，真实回执会出现在这里。
                  </p>
                )}
              </section>
            )}
            {tab === 'budget' && (
              <section className="managed-budget">
                <h2>平台统一承担模型额度</h2>
                <p>
                  使用服务端平台模型
                  Key。按填写的模型单价预留每次调用的费用上限，取得 token
                  用量后结算；失败或用量未知保留预留额。这里的金额是运营估算，服务商账单为最终依据。
                </p>
                {data.billing && (
                  <div className="managed-billing-detail">
                    <p>
                      <strong>记账账号 {data.billing.sponsor_number}</strong> ·{' '}
                      {data.billing.provider_host} / {data.billing.model}
                    </p>
                    <p>
                      实际由平台已配置的模型服务商账户付费，统一归入此运营账号的预算；切换角色不会切换付费凭证。
                    </p>
                    <p>
                      {data.billing.month}：已结算估算 ¥
                      {money(data.billing.usage.settled_fen)} ·
                      执行中或未知用量预留 ¥
                      {money(data.billing.usage.reserved_fen)}
                    </p>
                    <p>
                      输入 {data.billing.usage.input_tokens.toLocaleString()} /
                      输出 {data.billing.usage.output_tokens.toLocaleString()}{' '}
                      tokens。这里是预算账本，不是服务商钱包余额。
                    </p>
                  </div>
                )}
                {campaign ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        await api('console/managed/campaign', campaign, 'PUT');
                        setCampaign(undefined);
                      }, '预算与调度设置已保存');
                    }}
                  >
                    <label>
                      每月预算（元）
                      <input
                        required
                        type="number"
                        step="0.01"
                        min="0"
                        max="100000"
                        value={campaign.monthly_budget_fen / 100}
                        onChange={(e) =>
                          setCampaign({
                            ...campaign,
                            monthly_budget_fen: Math.round(
                              Number(e.target.value) * 100,
                            ),
                          })
                        }
                      />
                    </label>
                    <div className="managed-hours">
                      <label>
                        每百万输入 tokens（元）
                        <input
                          required
                          type="number"
                          step="0.01"
                          min="0"
                          max="10000"
                          value={campaign.input_fen_per_million / 100}
                          onChange={(e) =>
                            setCampaign({
                              ...campaign,
                              input_fen_per_million: Math.round(
                                Number(e.target.value) * 100,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        每百万输出 tokens（元）
                        <input
                          required
                          type="number"
                          step="0.01"
                          min="0"
                          max="10000"
                          value={campaign.output_fen_per_million / 100}
                          onChange={(e) =>
                            setCampaign({
                              ...campaign,
                              output_fen_per_million: Math.round(
                                Number(e.target.value) * 100,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <p className="managed-subtle">
                      请按实际模型填写保守单价，含推理费用。每月北京时间 1
                      日重置统计。调整预算不会清空已经发生的用量。
                    </p>
                    <label className="managed-check">
                      <input
                        type="checkbox"
                        checked={campaign.enabled}
                        onChange={(e) =>
                          setCampaign({
                            ...campaign,
                            enabled: e.target.checked,
                          })
                        }
                      />{' '}
                      开启自动调度
                    </label>
                    <button className="managed-primary" disabled={busy}>
                      保存预算与调度
                    </button>
                  </form>
                ) : data.campaign ? (
                  <button
                    onClick={() => setCampaign(data.campaign || undefined)}
                  >
                    编辑预算与调度
                  </button>
                ) : (
                  <p>先在角色管理中注册角色库。</p>
                )}
              </section>
            )}
            {tab === 'audit' && (
              <section className="managed-log">
                <h2>管理员操作记录</h2>
                <p>账号进入、资料修改、启停和预算调整均保留记录。</p>
                {data.audit.map((a, i) => (
                  <article key={`${a.created_at}-${i}`}>
                    <div>
                      <strong>{auditLabels[a.action] || a.action}</strong>
                      <time>{date(a.created_at)}</time>
                    </div>
                    {a.agent_id && (
                      <p>
                        {members.find((m) => m.id === a.agent_id)?.name ||
                          a.agent_id}
                      </p>
                    )}
                  </article>
                ))}
                {!data.audit.length && (
                  <p className="managed-empty">暂无操作记录。</p>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
