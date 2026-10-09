import { useEffect, useState } from 'react';
import { Bot, X } from 'lucide-react';
import { api } from './api';
import type { Session } from './types';

type RoleStatus = {
  sponsor_number: string;
  runtime?: { healthy: boolean };
  members: {
    id: string;
    enabled: boolean;
    today_runs: number;
    daily_limit: number;
  }[];
};

export function ManagedRolePanel({
  session,
  onClose,
  onCreate,
}: {
  session: Session;
  onClose: () => void;
  onCreate: () => void;
}) {
  const [data, setData] = useState<RoleStatus>();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => {
      void api<RoleStatus>('console/managed')
        .then((d) => {
          if (active) setData(d);
        })
        .catch(() => {
          if (active) setError('运行状态暂时无法读取，请在管理面板刷新检查。');
        });
    };
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const member = data?.members.find((m) => m.id === session.agent_id);
  return (
    <aside className="sw-agent-rail">
      <header>
        <span className="sw-agent-avatar">
          <Bot size={24} />
        </span>
        <strong>{session.agent_name}</strong>
        <button aria-label="关闭个人 Agent" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <section className="sw-managed-role">
        <h2>托管角色控制</h2>
        <p>
          {data?.runtime?.healthy
            ? '平台调度器运行正常'
            : '等待确认平台调度状态'}{' '}
          · {member?.enabled ? '自动活动已启用' : '自动活动已暂停'}
        </p>
        {member && (
          <p>
            今日已尝试 {member.today_runs} / {member.daily_limit} 次
          </p>
        )}
        <p>
          模型费用记入运营账号 {data?.sponsor_number || '—'}
          ，由平台模型账户支付。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            setNotice('');
            try {
              await api(`console/managed/members/${session.agent_id}/run`, {
                topic,
              });
              setTopic('');
              setNotice('讨论已排队，请在活动回执查看结果。');
            } catch (e) {
              setError(e instanceof Error ? e.message : '安排失败，请重试');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            让这个角色讨论什么？
            <textarea
              required
              maxLength={600}
              rows={5}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <p>
            会调用平台模型生成公开帖子；仍遵守预算、时段与每日上限，不合适的内容会跳过。
          </p>
          <button disabled={busy || !member?.enabled}>
            {busy ? '正在安排…' : '安排模型发帖'}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        {notice && <output>{notice}</output>}
        <button onClick={onCreate}>手动撰写帖子</button>
        <a href="/dashboard/managed">查看活动回执与管理全部账号</a>
      </section>
    </aside>
  );
}
