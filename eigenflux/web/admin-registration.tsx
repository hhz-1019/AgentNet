import { useEffect, useState } from 'react';
import { RefreshCw } from './icons';
import { api, ApiError } from './api';
import { AdminNav } from './admin-nav';
import './analytics.css';
import './admin-members.css';
import './admin-registration.css';

export const registrationSteps = [
  '开始注册',
  '验证码已发送',
  '提交注册',
  '账号已创建',
  '进入画像确认',
  '完成注册',
];
const fields: Record<string, string> = {
  form: '注册表单',
  phone: '手机号',
  code: '短信验证码',
  password: '账号密码',
  confirm_password: '确认密码',
  profile: '确认画像',
  unknown: '历史未记录',
};
const states: Record<string, string> = {
  dormant: '超时未继续',
  active: '进行中',
  completed: '已完成',
  legacy: '历史待完成',
};
const errorStages: Record<string, string> = {
  sms: '短信发送',
  register: '创建账号',
  profile: '画像确认',
};
const stamp = (v: number | null) =>
  v
    ? new Date(v).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '未记录';
export type RegistrationData = {
  generated_at: number;
  collection_started_at: number;
  days: number;
  idle_minutes: number;
  page: number;
  page_size: number;
  total: number;
  summary: {
    started: number;
    completed: number;
    dormant: number;
    active: number;
    legacy_pending: number;
  };
  funnel: { step: number; reached: number; stalled: number }[];
  journeys: {
    agent_id: string;
    name: string;
    number: string | null;
    source: string;
    step: number;
    status: string;
    last_input: string;
    started_at: number;
    last_seen_at: number | null;
    sms_at: number | null;
    submitted_at: number | null;
    registered_at: number | null;
    profile_at: number | null;
    completed_at: number | null;
    error_code: string | null;
    error_stage: string | null;
    error_at: number | null;
  }[];
};

export function AdminRegistration({ preview = false }: { preview?: boolean }) {
  const [days, setDays] = useState(7),
    [idle, setIdle] = useState(30),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1);
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [version, setVersion] = useState(0);
  const [data, setData] = useState<RegistrationData>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const key = `days=${days}&idle=${idle}&status=${status}&page=${page}&q=${encodeURIComponent(search)}`;
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => {
    document.title = '注册流程分析 · elsewhere';
  }, []);
  useEffect(() => {
    let active = true,
      timer = 0,
      denied = false,
      inFlight = false;
    async function load() {
      if (document.hidden || inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      setBusy(true);
      try {
        const next = await api<RegistrationData>(
          `console/admin/registration?${key}`,
        );
        if (active) {
          setData(next);
          setLoadedKey(key);
          setError('');
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : '读取失败');
          if (e instanceof ApiError && [401, 403].includes(e.status)) {
            setData(undefined);
            denied = true;
          }
        }
      } finally {
        inFlight = false;
        if (active) {
          setBusy(false);
          if (!denied && !document.hidden)
            timer = window.setTimeout(() => void load(), 15000);
        }
      }
    }
    function visible() {
      clearTimeout(timer);
      if (!document.hidden && !denied) void load();
    }
    void load();
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key, version]);
  const snapshot = key === loadedKey ? data : undefined;
  const summary = snapshot?.summary;
  const worst = snapshot?.funnel
    .filter((f) => f.step < 6)
    .reduce<{ step: number; stalled: number } | null>(
      (best, f) => (!best || f.stalled > best.stalled ? f : best),
      null,
    );
  return (
    <div className="analytics-page">
      <AdminNav active="registration" />
      <main className="analytics-main members-main registration-main">
        {preview && (
          <p className="registration-note">
            演示数据 · 用于检查页面，非线上注册记录
          </p>
        )}
        <div className="analytics-heading">
          <div>
            <h1>注册流程分析</h1>
            <p>看清注册停在哪里，再找到需要改善的环节。</p>
          </div>
          <button onClick={() => setVersion((v) => v + 1)} disabled={busy}>
            <RefreshCw size={16} />
            刷新数据
          </button>
        </div>
        <div className="registration-controls">
          <label>
            首次注册事件
            <select
              aria-label="统计周期"
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setPage(1);
              }}
            >
              {[7, 30, 90].map((n) => (
                <option key={n} value={n}>
                  近 {n} 天
                </option>
              ))}
            </select>
          </label>
          <label>
            未继续判定
            <select
              aria-label="未继续时长"
              value={idle}
              onChange={(e) => {
                setIdle(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={30}>超过 30 分钟</option>
              <option value={1440}>超过 24 小时</option>
            </select>
          </label>
          <p>
            每 15 秒更新 · 北京时间
            <br />
            {snapshot
              ? `最近成功更新 ${stamp(snapshot.generated_at)}`
              : '正在读取…'}
          </p>
        </div>
        {error && (
          <p role="alert" className="registration-error">
            {error} {snapshot ? '当前保留上次成功的数据。' : ''}
            <button onClick={() => setVersion((v) => v + 1)}>重新读取</button>
          </p>
        )}
        <section
          className="members-summary registration-summary"
          aria-label="注册概览"
        >
          {[
            ['开始注册', summary?.started],
            ['已完成', summary?.completed],
            ['超时未继续', summary?.dormant],
            ['仍在进行', summary?.active],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <span>{label}</span>
              <strong>{value ?? '—'}</strong>
            </div>
          ))}
        </section>
        <section aria-labelledby="registration-funnel-title">
          <div className="registration-section-heading">
            <h2 id="registration-funnel-title">哪一步停留最多</h2>
            <p>
              {worst && worst.stalled > 0
                ? `${registrationSteps[worst.step - 1]} · ${worst.stalled} 次超时未继续`
                : '暂无超时未继续的已采集记录'}
            </p>
          </div>
          <div className="registration-table-scroll">
            <table className="registration-table">
              <thead>
                <tr>
                  <th scope="col">注册步骤</th>
                  <th scope="col">到达</th>
                  <th scope="col">继续到下一步</th>
                  <th scope="col">超时停在此步</th>
                </tr>
              </thead>
              <tbody>
                {registrationSteps.map((label, i) => {
                  const row = snapshot?.funnel[i],
                    next = snapshot?.funnel[i + 1];
                  return (
                    <tr key={label}>
                      <th scope="row">
                        <span className="registration-step-number">
                          {i + 1}
                        </span>
                        {label}
                        <div className="registration-bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${summary?.started && row ? (100 * row.reached) / summary.started : 0}%`,
                            }}
                          />
                        </div>
                      </th>
                      <td>{row?.reached ?? '—'}</td>
                      <td>
                        {i === 5
                          ? '已完成'
                          : row?.reached && next
                            ? `${((100 * next.reached) / row.reached).toFixed(1)}%`
                            : '—'}
                      </td>
                      <td>{i === 5 ? '—' : (row?.stalled ?? '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="registration-note">
            “超时未继续”表示超过所选时长没有前台活动，无法确认是否关闭页面或永久放弃。到达后续步骤视为经过前序步骤；历史未采集记录不加入漏斗。
          </p>
        </section>
        <section aria-labelledby="registration-list-title">
          <div className="registration-section-heading">
            <h2 id="registration-list-title">注册进度明细</h2>
            <p>
              历史待完成 {summary?.legacy_pending ?? '—'} 条 · 仅能确认现有状态
            </p>
          </div>
          <form
            className="members-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
              setPage(1);
            }}
          >
            <label className="members-search">
              查找账号或 Agent
              <input
                aria-label="搜索注册记录"
                maxLength={80}
                placeholder="账号 / 名称 / Agent ID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button type="submit">搜索</button>
            <label>
              注册状态
              <select
                aria-label="注册状态"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">全部记录</option>
                {Object.entries(states).map(([v, label]) => (
                  <option value={v} key={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </form>
          <p className="registration-note">
            {snapshot ? `找到 ${snapshot.total} 条记录` : '正在读取记录…'}
          </p>
          <div className="registration-table-scroll">
            <table className="registration-table registration-records">
              <thead>
                <tr>
                  <th scope="col">账号 / 待注册 Agent</th>
                  <th scope="col">最后步骤</th>
                  <th scope="col">状态</th>
                  <th scope="col">最近前台活动</th>
                  <th scope="col">详情</th>
                </tr>
              </thead>
              <tbody>
                {snapshot?.journeys.map((j) => (
                  <tr key={j.agent_id}>
                    <th scope="row">
                      {j.name || '未命名 Agent'}
                      <small>
                        {j.number ? `账号 ${j.number}` : '尚未创建账号'}
                      </small>
                      <small>Agent {j.agent_id}</small>
                    </th>
                    <td>
                      {j.source === 'legacy'
                        ? j.number
                          ? '账号已创建，待确认画像'
                          : '待创建账号，历史步骤未知'
                        : registrationSteps[j.step - 1]}
                      <small>
                        最近操作：{fields[j.last_input] || '未记录'}
                      </small>
                    </td>
                    <td>{states[j.status]}</td>
                    <td>{stamp(j.last_seen_at)}</td>
                    <td>
                      <details>
                        <summary>查看记录</summary>
                        <dl>
                          {[
                            ['首次记录', j.started_at],
                            ['短信已发送', j.sms_at],
                            ['首次提交注册', j.submitted_at],
                            ['账号创建', j.registered_at],
                            ['进入画像确认', j.profile_at],
                            ['完成注册', j.completed_at],
                          ].map(([label, v]) => (
                            <div key={String(label)}>
                              <dt>{label}</dt>
                              <dd>{stamp(v as number | null)}</dd>
                            </div>
                          ))}
                        </dl>
                        {j.error_code && (
                          <p>
                            最近失败：
                            {errorStages[j.error_stage || ''] || '注册'}
                            <br />
                            <code>{j.error_code}</code>
                            <br />
                            {stamp(j.error_at)}
                            <br />
                            这是历史失败记录，不代表当前仍有错误。
                          </p>
                        )}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {snapshot && !snapshot.journeys.length && (
            <p className="registration-empty">
              没有符合条件的注册记录。可调整筛选；新步骤会从采集启用后开始出现。
            </p>
          )}
          <div className="members-pagination">
            <span>
              每页 25 条 · 第 {page} /{' '}
              {Math.max(1, Math.ceil((snapshot?.total || 0) / 25))} 页
            </span>
            <div>
              <button
                disabled={busy || page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <button
                disabled={busy || !snapshot || page * 25 >= snapshot.total}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </section>
        <details className="registration-method">
          <summary>采集范围与判断口径</summary>
          <p>
            采集开始：
            {snapshot ? stamp(snapshot.collection_started_at) : '读取中'}
            。从打开注册页面后的注册表单开始，按待注册 Agent
            去重；同一个人重新创建 Agent
            可能产生多次尝试，不等于独立访客人数。复制接入指令前后的匿名浏览不在当前采集范围。
          </p>
          <p>
            仅记录步骤名称、时间和服务端失败类型，不记录手机号、密码、短信验证码或输入内容。短信发送成功不等于短信已被用户收到；账号创建与注册完成依据服务端真实记录。
          </p>
          <p>
            历史待完成记录只表示当前仍未完成，无法还原过去在哪个输入框离开，也不判定为本周期流失；它们不受日期筛选限制。官方托管
            Agent 不进入此栏目。
          </p>
        </details>
      </main>
    </div>
  );
}
