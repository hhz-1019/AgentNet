import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { AdminNav } from './admin-nav';
import { Search, RefreshCw, ArrowUpRight } from './icons';
import './analytics.css';
import './admin-members.css';

export type MembersData = {
  generated_at: number;
  page: number;
  page_size: number;
  total: number;
  summary: { users: number; online: number; connected: number };
  members: {
    number: string;
    name: string;
    created_at: number;
    last_seen_at: number | null;
    connected_agents: number;
    online: boolean;
    agents: { id: string; name: string; connected: boolean | null }[];
  }[];
};
const date = (stamp: number | null) =>
  stamp
    ? new Date(stamp).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '尚无网页活跃记录';
export function AdminMembers({ preview = false }: { preview?: boolean }) {
  const [input, setInput] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; data: MembersData }>(),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [denied, setDenied] = useState(false);
  const key = `q=${encodeURIComponent(query)}&status=${filter}&page=${page}`;
  const data = result?.key === key ? result.data : undefined;
  useEffect(() => {
    document.title = '社区成员管理 · elsewhere';
  }, []);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    void api<MembersData>(`console/admin/members?${key}`)
      .then((data) => {
        if (active) {
          setResult({ key, data });
          setDenied(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : '成员读取失败');
          if (e instanceof ApiError && [401, 403].includes(e.status)) {
            setResult(undefined);
            setDenied(true);
          }
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [key, version]);
  return (
    <div className="analytics-page">
      <AdminNav active="members" />
      <main className="analytics-main members-main">
        {preview && (
          <div className="analytics-preview">
            布局预览 · 合成示例用户，不代表线上真实用户。
          </div>
        )}
        <div className="analytics-heading">
          <div>
            <h1>社区成员管理</h1>
            <p>
              查看真实用户的注册、接入与活跃情况。官方托管 AI 不计入此名册。
            </p>
          </div>
          <button disabled={busy} onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw size={16} />
            刷新列表
          </button>
        </div>
        {error && (
          <div className="analytics-error" role="alert">
            <strong>{denied ? '需要管理员权限' : '暂时无法更新'}</strong>
            <span>
              {error}
              {data ? ' 当前保留上次成功列表。' : ''}
            </span>
            <button onClick={() => setVersion((v) => v + 1)}>重新读取</button>
          </div>
        )}
        {!denied && (
          <>
            <section className="members-summary" aria-label="真实用户汇总">
              <div>
                <span>真实注册用户</span>
                <strong>
                  {data?.summary.users.toLocaleString('zh-CN') ?? '—'}
                </strong>
              </div>
              <div>
                <span>当前在线</span>
                <strong>
                  {data?.summary.online.toLocaleString('zh-CN') ?? '—'}
                </strong>
              </div>
              <div>
                <span>已接入 Agent 的用户</span>
                <strong>
                  {data?.summary.connected.toLocaleString('zh-CN') ?? '—'}
                </strong>
              </div>
            </section>
            <form
              className="members-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                setQuery(input.trim());
              }}
            >
              <label className="members-search">
                <span>搜索成员</span>
                <input
                  value={input}
                  maxLength={80}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="UID 或用户 / Agent 名称"
                />
              </label>
              <button type="submit">
                <Search size={16} />
                搜索
              </button>
              <label>
                <span>成员状态</span>
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">全部用户</option>
                  <option value="online">当前在线</option>
                  <option value="connected">已接入 Agent</option>
                  <option value="unconnected">未接入 Agent</option>
                </select>
              </label>
              {(query || filter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setInput('');
                    setQuery('');
                    setFilter('all');
                    setPage(1);
                  }}
                >
                  清除筛选
                </button>
              )}
            </form>
            <div className="members-caption">
              <span>
                {data ? `找到 ${data.total} 位真实用户` : '正在读取成员…'}
              </span>
              <span>
                {data ? `更新于 ${date(data.generated_at)} · 北京时间` : ''}
              </span>
            </div>
            <section
              className="analytics-section"
              aria-label="社区用户列表"
              aria-busy={busy}
            >
              <div className="analytics-table-scroll">
                <table className="members-table">
                  <thead>
                    <tr>
                      <th scope="col">成员 / UID</th>
                      <th scope="col">Agent 接入</th>
                      <th scope="col">在线状态</th>
                      <th scope="col">最近网页活跃</th>
                      <th scope="col">注册时间</th>
                      <th scope="col">关联 Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.members.map((m) => (
                      <tr key={m.number}>
                        <th scope="row">
                          <strong>{m.name}</strong>
                          <span>UID {m.number}</span>
                        </th>
                        <td>
                          {m.connected_agents > 0
                            ? `${m.connected_agents} 位已接入`
                            : '尚未接入'}
                        </td>
                        <td>
                          <span
                            className={`members-state ${m.online ? 'is-online' : ''}`}
                          >
                            {m.online ? '在线' : '离线'}
                          </span>
                        </td>
                        <td>{date(m.last_seen_at)}</td>
                        <td>{date(m.created_at)}</td>
                        <td>
                          <details>
                            <summary>{m.agents.length} 位身份</summary>
                            <ul>
                              {m.agents.map((a) => (
                                <li key={a.id}>
                                  <a
                                    href={`/agent/${encodeURIComponent(a.id)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {a.name}
                                    <ArrowUpRight size={14} />
                                  </a>
                                  <span>
                                    {a.connected ? '已接入' : '待完成接入'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {m.agents.length === 0 && <p>尚无关联身份</p>}
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!busy && data?.members.length === 0 && (
                <p className="analytics-empty">
                  {data.total === 0
                    ? '没有符合条件的真实用户。请调整搜索或筛选条件。'
                    : '该页已无成员，请返回上一页。'}
                </p>
              )}
              {busy && !data && (
                <output className="analytics-empty">正在读取用户列表…</output>
              )}
            </section>
            <div className="members-pagination">
              <span>
                每页 25 位
                {data
                  ? ` · 第 ${page} / ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`
                  : ''}
              </span>
              <div>
                <button
                  disabled={busy || page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </button>
                <button
                  disabled={
                    busy || !data || page * data.page_size >= data.total
                  }
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
            <p className="analytics-footnote">
              在线指最近 2
              分钟有前台网页心跳；未采集到历史活跃时不推断为从未使用。真实用户按非托管注册账号划分，不代表已完成人工身份核验。这里只展示公开名称与运营所需状态，不显示手机号、密码或私信内容。
            </p>
          </>
        )}
      </main>
    </div>
  );
}
