import { useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  ShieldCheck,
  Radio,
  Clock,
  AlertCircle,
  Network,
} from 'lucide-react';
import type {
  Agent,
  Activity,
  Approval,
  Act,
  Notify,
  Navigate,
  Presence,
  Dashboard,
  Task,
} from './types';
import {
  taskLabels,
  policyLabels,
  relationLabels,
  activityLabels,
} from './types';
export const date = (time: number) =>
  time
    ? new Date(time).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '尚无记录';
export const relative = (time: number, now = Date.now()) =>
  !time
    ? '尚未连接'
    : now - time < 60000
      ? '刚刚'
      : now - time < 3600000
        ? `${Math.floor((now - time) / 60000)} 分钟前`
        : now - time < 86400000
          ? `${Math.floor((now - time) / 3600000)} 小时前`
          : date(time);
export function AgentAvatar({
  agent,
  small = false,
}: {
  agent: Agent;
  small?: boolean;
}) {
  return (
    <span className={`agent-avatar ${small ? 'small' : ''}`}>
      {agent.initials || agent.name.slice(0, 2)}
    </span>
  );
}
export function AgentStatus({
  status,
  label,
}: {
  status: Presence;
  label?: string;
}) {
  return (
    <span className={`status ${status}`}>
      <span className="status-dot" />
      {label ||
        {
          online: '在线',
          working: '工作中',
          waiting: '等待中',
          offline: '离线',
          error: '异常',
        }[status]}
    </span>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
export function RelationBadge({ type }: { type: string }) {
  return <Badge>{relationLabels[type] || type}</Badge>;
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Network size={26} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Section({
  title,
  aside,
  children,
  className = '',
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section ${className}`}>
      <div className="section-heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function CopyId({ id, notify }: { id: string; notify: Notify }) {
  return (
    <button
      className="copy-id"
      title={id}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          notify('Agent ID 已复制。');
        } catch {
          notify(`Agent ID：${id}`);
        }
      }}
    >
      <code>{id}</code>
      <Copy size={12} />
      <span className="sr-only">复制 Agent ID</span>
    </button>
  );
}
export function AgentCard({
  data,
  notify,
  navigate,
}: {
  data: Dashboard;
  notify: Notify;
  navigate: Navigate;
}) {
  const a = data.profile;
  return (
    <section className="identity-card">
      <div className="identity-heading">
        <AgentAvatar agent={a} />
        <div>
          <h2>{a.name}</h2>
          <p>
            {a.role}{' '}
            <span className="muted">· 由 {data.account?.username} 管理</span>
          </p>
        </div>
        <AgentStatus status={data.presence.status} />
      </div>
      <CopyId id={a.id} notify={notify} />
      <p className="identity-bio">{a.bio}</p>
      <div className="badges">
        {a.capabilities.slice(0, 6).map((c) => (
          <Badge key={c}>{c}</Badge>
        ))}
      </div>
      <div className="working-line">
        <Radio size={17} />
        <div>
          <span>
            {data.presence.status === 'working'
              ? '正在执行'
              : data.presence.status === 'waiting'
                ? '正在等待'
                : '运行状态'}
          </span>
          <p>{data.presence.detail}</p>
        </div>
      </div>
      <footer>
        <span>最近在线 {relative(a.lastSeenAt, data.serverTime)}</span>
        <button className="text-button" onClick={() => navigate('agent')}>
          管理身份 <ArrowUpRight size={14} />
        </button>
      </footer>
    </section>
  );
}
export function ActivityItem({
  event,
  navigate,
}: {
  event: Activity;
  navigate: Navigate;
}) {
  const dest = event.task_id
    ? `tasks/${event.task_id}`
    : event.conversation_id
      ? `messages/${event.conversation_id}`
      : event.peer_id
        ? `network/${event.peer_id}`
        : event.approval_id
          ? 'settings/approvals'
          : null;
  return (
    <li className="activity-item">
      <time dateTime={new Date(event.created_at).toISOString()}>
        <span className="activity-date">
          {new Date(event.created_at).toLocaleDateString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
          })}
        </span>
        {new Date(event.created_at).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </time>
      <span className={`event-point ${event.source}`} />
      <div>
        {dest ? (
          <button className="event-link" onClick={() => navigate(dest)}>
            {event.title}
            <ChevronRight size={13} />
          </button>
        ) : (
          <strong>{event.title}</strong>
        )}
        {event.detail && (
          <p>
            {taskLabels[event.detail as keyof typeof taskLabels] ||
              event.detail}
          </p>
        )}
        <small>
          {activityLabels[event.type] || event.type} ·{' '}
          {event.source === 'human'
            ? '由你操作'
            : event.source === 'system'
              ? '系统事件'
              : 'Agent 行为'}
        </small>
      </div>
    </li>
  );
}
export function Timeline({
  events,
  navigate,
  limit,
}: {
  events: Activity[];
  navigate: Navigate;
  limit?: number;
}) {
  return (
    <ol className="timeline">
      {(limit ? events.slice(0, limit) : events).map((e) => (
        <ActivityItem key={e.id} event={e} navigate={navigate} />
      ))}
    </ol>
  );
}
export function TaskCard({
  task,
  data,
  navigate,
}: {
  task: Task;
  data: Dashboard;
  navigate: Navigate;
}) {
  const peer = [data.profile, ...data.agents].find(
    (a) =>
      a.id ===
      (task.source_agent_id === data.profile.id
        ? task.target_agent_id
        : task.source_agent_id),
  );
  return (
    <button className="task-row" onClick={() => navigate(`tasks/${task.id}`)}>
      <div>
        <span className={`task-status ${task.status}`}>
          <Clock size={13} />
          {taskLabels[task.status]}
        </span>
        <h3>{task.task}</h3>
        <p>
          {task.source_agent_id === data.profile.id ? '委托给' : '来自'}{' '}
          {peer?.name || '未知 Agent'} · {date(task.created_at)}
        </p>
      </div>
      <ChevronRight size={18} />
    </button>
  );
}
export function PermissionRequest({
  approval,
  act,
  busy,
}: {
  approval: Approval;
  act: Act;
  busy: boolean;
}) {
  const [permissions, setPermissions] = useState(approval.permissions);
  return (
    <article className="approval-card">
      <div className="section-heading">
        <Badge>{policyLabels[approval.category] || approval.category}</Badge>
        <span>{date(approval.created_at)}</span>
      </div>
      <h3>{approval.summary}</h3>
      <p>Agent 正在等待你的决定。批准仅适用于这一项请求。</p>
      <details>
        <summary>查看请求内容与权限</summary>
        <pre>{JSON.stringify(approval.payload, null, 2)}</pre>
        {approval.permissions.length > 0 ? (
          <fieldset>
            <legend>允许的权限（可收窄）</legend>
            {approval.permissions.map((p) => (
              <label className="check-row" key={p}>
                <input
                  type="checkbox"
                  checked={permissions.includes(p)}
                  onChange={(e) =>
                    setPermissions(
                      e.target.checked
                        ? [...permissions, p]
                        : permissions.filter((x) => x !== p),
                    )
                  }
                />
                {p}
              </label>
            ))}
          </fieldset>
        ) : (
          <p>未申请额外权限。</p>
        )}
      </details>
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            act(
              'decide_approval',
              { approval_id: approval.id, decision: 'approve', permissions },
              '已批准，等待 Agent 继续执行。',
            )
          }
        >
          <Check size={15} />
          批准此次请求
        </button>
        <button
          className="outline danger"
          disabled={busy}
          onClick={() =>
            act(
              'decide_approval',
              { approval_id: approval.id, decision: 'reject' },
              '已拒绝。',
            )
          }
        >
          拒绝
        </button>
      </div>
    </article>
  );
}
export function PendingActions({
  data,
  navigate,
}: {
  data: Dashboard;
  navigate: Navigate;
}) {
  const pending = data.approvals.filter((a) => a.status === 'pending');
  return (
    <Section
      title="需要你的关注"
      aside={<ShieldCheck size={16} />}
      className="attention-panel"
    >
      {pending.length ? (
        <>
          <span className="attention-count">{pending.length} 项待审批</span>
          {pending.slice(0, 3).map((a) => (
            <button
              className="attention-item"
              key={a.id}
              onClick={() => navigate('settings/approvals')}
            >
              <AlertCircle size={16} />
              <span>
                {a.summary}
                <small>{policyLabels[a.category]}</small>
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
        </>
      ) : (
        <div className="clear-state">
          <ShieldCheck size={25} />
          <h3>目前无需你介入</h3>
          <p>当 Agent 请求额外权限时，会在这里等你决定。</p>
        </div>
      )}
      <button
        className="text-button"
        onClick={() => navigate('settings/approvals')}
      >
        打开审批中心 <ArrowUpRight size={14} />
      </button>
    </Section>
  );
}
