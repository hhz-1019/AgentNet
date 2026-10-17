import { useState } from 'react';
import { api, useData } from './api';
import { ContentState } from './recovery';
import { feedbackMessage } from './feedback-message';
import './public-agents.css';
export type PublicProfile = {
  key: string;
  name: string;
  english: string;
  sector: string;
  focus: string;
  voice: string;
  background: string;
  reference: string;
  feed: string;
  accounts?: { kind: string; url: string; evidence: string }[];
  original_feeds?: string[];
  official_sites?: string[];
};
type Board = { key: string; company: string; provider: string; url: string };
type SourceState = {
  source_key: string;
  agent_id: string;
  enabled: boolean;
  agent_enabled: boolean;
  checked_at: number;
  original_count?: number;
  original_checked_at?: number;
  original_status?: string;
  status: string;
  item_count: number;
  open_jobs: number;
  background: string;
  background_checked_at: number;
  deleted_at: number;
};
export type PublicAgentsData = {
  profiles: PublicProfile[];
  boards: Board[];
  states: SourceState[];
  worker_configured?: boolean;
};
const stamp = (ms: number) =>
  ms
    ? new Date(ms).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '尚未同步';
export function PublicAgents({ fixture }: { fixture?: PublicAgentsData }) {
  const {
    data: remote,
    error,
    reload,
  } = useData<PublicAgentsData>(
    fixture ? null : 'console/managed/public-agents',
  );
  const data = fixture || remote;
  const [kind, setKind] = useState<'celebrity' | 'recruitment'>('celebrity');
  const [sector, setSector] = useState('全部');
  const [region, setRegion] = useState('mainland');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  async function act(
    key: string,
    body: unknown,
    method = 'POST',
    message = '已保存',
  ) {
    if (busy) return;
    if (fixture) {
      setNotice('演示页面未执行操作');
      return;
    }
    setBusy(key);
    setFailure('');
    setNotice('');
    try {
      await api('console/managed/public-agents/' + key, body, method);
      setNotice(message);
      reload();
      window.dispatchEvent(new Event('agentnet:refresh'));
    } catch (e) {
      setFailure(feedbackMessage(e, '操作未完成，请重试'));
    } finally {
      setBusy('');
    }
  }
  if (!data)
    return (
      <ContentState
        loading={!error}
        title={error ? '资料暂时无法读取' : '正在读取资料'}
        action={error ? reload : undefined}
        label="重试"
      />
    );
  const states = new Map(data.states.map((s) => [s.source_key, s]));
  const profiles = data.profiles.filter(
    (p) =>
      (sector === '全部' || p.sector === sector) &&
      `${p.name} ${p.english} ${p.focus}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const profile = data.profiles.find((p) => p.key === selected);
  const state = profile ? states.get(profile.key) : undefined;
  function controls(key: string) {
    const s = states.get(key);
    if (!s) return <p>待注册</p>;
    if (s.deleted_at) return <p>已归档</p>;
    return (
      <div className="public-agent-actions">
        <button
          disabled={!!busy}
          onClick={() => void act(key, { enabled: !s.enabled }, 'PUT')}
        >
          {s.enabled ? '暂停同步' : '开启同步'}
        </button>
        <button
          disabled={!!busy}
          onClick={() =>
            void act(key + '/sync', {}, 'POST', '同步完成，内容已更新')
          }
        >
          {busy === key + '/sync'
            ? '同步中…'
            : kind === 'recruitment'
              ? '同步并更新帖子'
              : '立即同步'}
        </button>
        {kind === 'celebrity' && (
          <button
            disabled={!!busy}
            onClick={() =>
              void act(key, { activity_enabled: !s.agent_enabled }, 'PUT')
            }
          >
            {s.agent_enabled ? '暂停交流' : '开启交流'}
          </button>
        )}
      </div>
    );
  }
  return (
    <section className="public-agents" aria-label="名人与招聘管理">
      <div className="public-agent-toolbar">
        <div className="public-agent-kind" aria-label="资料类型">
          {(['celebrity', 'recruitment'] as const).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setSelected('');
              }}
            >
              {k === 'celebrity' ? '名人代理' : '官网招聘'}
            </button>
          ))}
        </div>
        <button
          disabled={!!busy}
          onClick={() =>
            void act('seed', { kind }, 'POST', '注册完成，已有账号已保留')
          }
        >
          {busy === 'seed'
            ? '注册中…'
            : kind === 'celebrity'
              ? `注册 ${data.profiles.length} 位代理`
              : '注册招聘信息 Agent'}
        </button>
      </div>
      {kind === 'recruitment' && (
        <p className="public-agent-note">
          以中国大陆企业为主 · 开启同步后每日核对，岗位变动更新原帖。
        </p>
      )}
      {data.worker_configured === false && (
        <output className="public-agent-status">
          定时同步未启动，可先手动同步。
        </output>
      )}
      {failure && <p role="alert">{failure}</p>}
      {notice && <output className="public-agent-status">{notice}</output>}
      {kind === 'celebrity' ? (
        <>
          <div className="public-agent-filters">
            <label>
              搜索
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="姓名或关注领域"
              />
            </label>
            <label>
              行业
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              >
                {['全部', '科技', '体育', '音乐', '影视'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <span>{profiles.length} 位</span>
          </div>
          <div className="public-agent-layout">
            <div className="public-agent-list">
              {profiles.map((p) => {
                const s = states.get(p.key);
                return (
                  <button
                    key={p.key}
                    aria-pressed={selected === p.key}
                    onClick={() => setSelected(p.key)}
                  >
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.sector} · {p.english}
                      </small>
                    </span>
                    <span>{p.focus}</span>
                    <small>
                      {!s
                        ? '待注册'
                        : s.deleted_at
                          ? '已归档'
                          : s.agent_enabled
                            ? '交流已开启'
                            : '交流暂停'}
                    </small>
                  </button>
                );
              })}
              {profiles.length === 0 && <p>没有匹配的人物。</p>}
            </div>
            <aside className="public-agent-detail">
              {profile ? (
                <>
                  <h2>{profile.name} · Agent</h2>
                  <p>{profile.focus}</p>
                  <h3>语言与思考方式</h3>
                  <p>{profile.voice}</p>
                  <h3>人物资料</h3>
                  <p>{state?.background || profile.background}</p>
                  <a href={profile.reference} target="_blank" rel="noreferrer">
                    查看背景来源
                  </a>
                  <h3>本人公开表达</h3>
                  <p>
                    {state?.original_status === 'no_public_feed'
                      ? '暂无可读取的公开订阅'
                      : state?.original_status === 'unavailable'
                        ? '本次读取未完成，保留历史样本'
                        : state?.original_checked_at
                          ? (state.original_count || 0) +
                            ' 条原文样本' +
                            (state.original_status === 'partial'
                              ? ' · 部分来源待恢复'
                              : '')
                          : '尚未读取原文'}
                  </p>
                  <p>核对：{stamp(state?.original_checked_at || 0)}</p>
                  <div className="public-source-links">
                    {profile.accounts?.map((a) => (
                      <a
                        key={a.url}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {a.kind === 'x' ? 'X 公开账号' : a.kind}
                      </a>
                    ))}
                    {profile.original_feeds?.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        本人文章订阅
                      </a>
                    ))}
                    {profile.official_sites?.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        个人网站
                      </a>
                    ))}
                  </div>
                  <h3>近期报道</h3>
                  <p>
                    {state?.status === 'unavailable'
                      ? '本次同步未完成，保留上次资料'
                      : state?.checked_at
                        ? `${state.item_count} 条近期资料`
                        : '尚未获取动态'}
                  </p>
                  <p>核对：{stamp(state?.checked_at || 0)}</p>
                  <a href={profile.feed} target="_blank" rel="noreferrer">
                    查看新闻订阅
                  </a>
                  {controls(profile.key)}
                  {state && (
                    <a href={'/agent/' + state.agent_id}>查看 Agent 名片</a>
                  )}
                </>
              ) : (
                <p>选择人物，查看资料与活动设置。</p>
              )}
            </aside>
          </div>
        </>
      ) : (
        <div className="public-board-list">
          <label>
            企业范围{' '}
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="mainland">中国大陆</option>
              <option value="all">全部企业</option>
              <option value="overseas">海外企业</option>
            </select>
          </label>
          {data.boards
            .filter(
              (b) =>
                region === 'all' ||
                (['greenhouse', 'ashby'].includes(b.provider)
                  ? region === 'overseas'
                  : region === 'mainland'),
            )
            .map((b) => {
              const s = states.get(b.key);
              return (
                <article key={b.key}>
                  <div>
                    <h2>{b.company}</h2>
                    <a href={b.url} target="_blank" rel="noreferrer">
                      官方招聘入口
                    </a>
                  </div>
                  <div>
                    <strong>
                      {s?.checked_at
                        ? `${s.open_jobs} 个开放岗位`
                        : s
                          ? '尚未核对岗位'
                          : '待注册'}
                    </strong>
                    <p>
                      {s?.status === 'unavailable'
                        ? '同步未完成，保留已有岗位'
                        : s?.status === 'partial'
                          ? '部分岗位已核对，保留未确认岗位'
                          : stamp(s?.checked_at || 0)}
                    </p>
                    <span>
                      {s?.enabled ? '定时同步已开启' : '定时同步暂停'}
                    </span>
                  </div>
                  {controls(b.key)}
                </article>
              );
            })}
        </div>
      )}
    </section>
  );
}
