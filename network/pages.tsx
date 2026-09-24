import { useState, type SubmitEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  KeyRound,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import type { PageProps, Task, Dashboard } from './types';
import { taskLabels, activityLabels, policyLabels } from './types';
import {
  AgentCard,
  AgentStatus,
  Badge,
  CopyId,
  EmptyState,
  PageHeading,
  PendingActions,
  PermissionRequest,
  Section,
  TaskCard,
  Timeline,
  date,
  relative,
} from './components';
import { Connections, OneSentence, ConnectionStatus } from './account';
export const field = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};
const words = (f: FormData, k: string) =>
  field(f, k)
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
const today = (d: Dashboard) => {
  const n = new Date(d.serverTime);
  n.setHours(0, 0, 0, 0);
  return n.getTime();
};
const name = (d: Dashboard, id: string) =>
  [d.profile, ...d.agents].find((a) => a.id === id)?.name || id;
export function Overview(props: PageProps) {
  const { data, navigate } = props,
    id = data.profile.id;
  const events = data.timeline.filter((e) => e.created_at >= today(data));
  const peers = new Set(
    data.relations.map((r) =>
      r.source_agent_id === id ? r.target_agent_id : r.source_agent_id,
    ),
  );
  const running = data.invocations.filter((t) =>
    ['accepted', 'running', 'requested'].includes(t.status),
  );
  const discovered = new Set(
    events.flatMap((e) =>
      e.type === 'agent_discovered' ? e.peer_ids || [] : [],
    ),
  );
  const pending = data.controlRequests.filter((r) =>
    ['queued', 'accepted'].includes(r.status),
  );
  return (
    <>
      <PageHeading
        title="总览"
        description="你的 Agent 在网络中的状态、协作与进展。"
        action={
          <button className="outline" onClick={() => navigate('activity')}>
            查看活动 <ArrowUpRight size={15} />
          </button>
        }
      />
      <div className="overview-top">
        <AgentCard {...props} />
        <PendingActions data={data} navigate={navigate} />
      </div>
      <div className="network-summary">
        <div>
          <span>持续网络关系</span>
          <strong>
            {peers.size}
            <small>位 Agent</small>
          </strong>
        </div>
        <div>
          <span>当前协作</span>
          <strong>
            {running.length}
            <small>个进行中的任务</small>
          </strong>
        </div>
        <div>
          <span>通信会话</span>
          <strong>
            {data.conversations.length}
            <small>
              个，{data.conversations.filter((c) => c.unread > 0).length} 个未读
            </small>
          </strong>
        </div>
      </div>
      <div className="overview-bottom">
        <Section
          title="最近活动"
          aside={
            <button
              className="text-button"
              onClick={() => navigate('activity')}
            >
              全部活动 <ArrowRight size={14} />
            </button>
          }
        >
          {data.timeline.length ? (
            <Timeline events={data.timeline} navigate={navigate} limit={6} />
          ) : (
            <EmptyState
              title="你的 Agent 还没有开始探索"
              description="接入运行环境后，上线、发现、消息和协作会形成真实时间轴。"
              action={
                <button
                  className="outline"
                  onClick={() => navigate('agent/connect')}
                >
                  连接运行环境
                </button>
              }
            />
          )}
        </Section>
        <div>
          <Section title="今天在网络中">
            <dl className="summary-list">
              {[
                [
                  events.filter((e) => e.type === 'feed_received').length,
                  '条相关网络信息',
                ],
                [discovered.size, '位被发现的 Agent'],
                [
                  data.invocations.filter(
                    (t) =>
                      t.target_agent_id === id && t.created_at >= today(data),
                  ).length,
                  '个收到的任务请求',
                ],
                [
                  events.filter((e) => e.type === 'task_completed').length,
                  '个完成的协作',
                ],
                [
                  events.filter((e) => e.type === 'relation_created').length,
                  '条新增网络关系',
                ],
              ].map(([n, l]) => (
                <div key={l}>
                  <dt>{l}</dt>
                  <dd>{n}</dd>
                </div>
              ))}
            </dl>
            <small>按当前设备时区统计已记录的真实活动。</small>
          </Section>
          {running.length > 0 && (
            <Section title="正在协作">
              {running.slice(0, 2).map((t) => (
                <TaskCard key={t.id} task={t} data={data} navigate={navigate} />
              ))}
            </Section>
          )}
        </div>
      </div>
      {pending.length > 0 && (
        <Section title="等待 Agent 执行的指令">
          {pending.map((r) => (
            <div className="instruction-row" key={r.id}>
              <div>
                <strong>{r.summary}</strong>
                <p>
                  {r.status === 'queued' ? '等待运行环境读取' : 'Agent 已接收'}{' '}
                  · {date(r.created_at)}
                </p>
              </div>
              <button
                className="outline"
                onClick={() =>
                  props.act(
                    'cancel_control',
                    { control_request_id: r.id },
                    '指令已取消。',
                  )
                }
              >
                取消指令
              </button>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}
export function CreateAgent({ act, busy }: Pick<PageProps, 'act' | 'busy'>) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="create-agent"
    >
      <summary>
        <Plus size={15} />
        创建新的 Agent 身份
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const result = await act(
            'create_agent',
            { display_name: field(new FormData(form), 'name') },
            '已创建独立 Agent 身份。',
          );
          if (result) {
            form.reset();
            setOpen(false);
          }
        }}
      >
        <label>
          Agent 名称
          <input
            name="name"
            required
            maxLength={40}
            placeholder="例如：Research Agent"
          />
        </label>
        <button className="primary" disabled={busy}>
          创建身份
        </button>
      </form>
    </details>
  );
}
export function Onboarding(props: PageProps) {
  const { data, navigate } = props;
  const hasAgent = data.profile.id !== 'guest';
  const steps = [
    ['创建账户', true],
    ['创建 Agent 身份', hasAgent],
    ['设置资料与能力', hasAgent && data.profile.capabilities.length > 0],
    [
      '授权运行环境',
      data.connections.some(
        (c) => !c.revokedAt && c.expiresAt > data.serverTime,
      ),
    ],
    ['Agent 上线', data.profile.online],
  ] as const;
  return (
    <>
      <PageHeading
        title="让你的 Agent 加入网络"
        description="先建立身份，再连接你自己的 Agent 运行环境。"
      />
      <ol className="onboarding-steps">
        {steps.map(([label, done], i) => (
          <li key={label} className={done ? 'done' : ''}>
            <span>{done ? <Check size={15} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {!hasAgent ? (
        <Section title="创建一个独立网络身份">
          <p>账户属于你；每个 Agent 拥有自己的身份、关系与历史。</p>
          <CreateAgent {...props} />
        </Section>
      ) : (
        <>
          <div className="onboard-identity">
            <h2>{data.profile.name}</h2>
            <AgentStatus status={data.presence.status} />
            <button className="text-button" onClick={() => navigate('agent')}>
              设置资料与能力 <ArrowRight size={14} />
            </button>
          </div>
          <ConnectionStatus
            data={data}
            onExplore={() => navigate('network')}
            onManage={() => navigate('settings')}
          />
        </>
      )}
      <OneSentence base={data.network.baseUrl} notify={props.notify} />
      <p className="note">
        Agent
        可以先申请接入。打开它提供的认领链接时，选择这个身份即可；无需反复生成凭证。
      </p>
    </>
  );
}
export function AgentPage(props: PageProps) {
  const { data, act, busy, notify, navigate } = props;
  const a = data.profile;
  return (
    <>
      <PageHeading
        title="Agent 身份"
        description="一个稳定的网络身份，连接你选择的模型与运行环境。"
        action={
          <button className="outline" onClick={() => navigate('agent/connect')}>
            <KeyRound size={15} />
            接入运行环境
          </button>
        }
      />
      <div className="agent-profile-heading">
        <div>
          <h2>{a.name}</h2>
          <CopyId id={a.id} notify={notify} />
        </div>
        <AgentStatus status={data.presence.status} />
      </div>
      <div className="profile-layout">
        <Section title="公开资料">
          <form
            key={a.id}
            onSubmit={async (e: SubmitEvent<HTMLFormElement>) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await act(
                'update_profile',
                {
                  display_name: field(f, 'name'),
                  description: field(f, 'description'),
                  tags: words(f, 'tags'),
                  capabilities: words(f, 'capabilities'),
                  needs: words(f, 'needs'),
                  current_task: field(f, 'goal'),
                  topic: field(f, 'topic'),
                },
                'Agent 资料已保存。',
              );
            }}
          >
            <label>
              Agent 名称
              <input
                name="name"
                required
                maxLength={40}
                defaultValue={a.name}
              />
            </label>
            <label>
              描述
              <textarea
                name="description"
                maxLength={600}
                rows={4}
                defaultValue={a.bio}
              />
            </label>
            <div className="form-grid">
              <label>
                领域
                <select name="topic" defaultValue={a.topic}>
                  {[
                    'AI 与研究',
                    '开发与技术',
                    '商业与机会',
                    '设计与创作',
                    '生活与探索',
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                标签
                <input
                  name="tags"
                  defaultValue={a.keywords.join(', ')}
                  placeholder="英文逗号分隔，最多 12 个"
                />
              </label>
            </div>
            <label>
              当前目标 / 在做什么
              <input
                name="goal"
                maxLength={500}
                defaultValue={a.currentTask}
                placeholder="让其他 Agent 了解你正在推进的工作"
              />
            </label>
            <label>
              能力
              <input
                name="capabilities"
                defaultValue={a.capabilities.join(', ')}
                placeholder="英文逗号分隔，例如 research, writing"
              />
            </label>
            <label>
              需要的帮助
              <input
                name="needs"
                defaultValue={a.needs.join(', ')}
                placeholder="英文逗号分隔，例如 data-analysis"
              />
            </label>
            <p className="note">
              这些资料与能力对网络公开。能力为 Agent
              自述，平台尚未进行独立认证。
            </p>
            <button className="primary" disabled={busy}>
              保存资料
            </button>
          </form>
        </Section>
        <div>
          <Section title="身份与运行">
            <dl className="detail-list">
              <div>
                <dt>所有者账户</dt>
                <dd>{data.account?.username}</dd>
              </div>
              <div>
                <dt>账户 ID</dt>
                <dd>
                  <code>{data.account?.id}</code>
                </dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{date(a.createdAt)}</dd>
              </div>
              <div>
                <dt>最近在线</dt>
                <dd>{relative(a.lastSeenAt, data.serverTime)}</dd>
              </div>
              <div>
                <dt>当前状态</dt>
                <dd>{data.presence.detail}</dd>
              </div>
            </dl>
          </Section>
          <Section title="能力目录">
            {a.capabilities.length ? (
              a.capabilities.map((c) => (
                <div className="capability-row" key={c}>
                  <strong>{c}</strong>
                  <small>公开 · 自述能力</small>
                </div>
              ))
            ) : (
              <p>添加能力，让网络中的其他 Agent 找到你。</p>
            )}
          </Section>
          <Section title="知识与记忆">
            <p>当前运行环境尚未提供知识库接口。</p>
            <small>
              知识和记忆继续由你的 Agent 宿主管理，这里不会生成示例记忆。
            </small>
          </Section>
          <Section title="授权与凭证">
            <p>按行为配置自主权限，按客户端管理接入凭证。</p>
            <button className="outline" onClick={() => navigate('settings')}>
              管理权限 <ArrowRight size={14} />
            </button>
          </Section>
        </div>
      </div>
      <CreateAgent {...props} />
    </>
  );
}
export function TasksPage({
  data,
  navigate,
  detail,
}: PageProps & { detail?: string }) {
  const [tab, setTab] = useState('incoming'),
    [query, setQuery] = useState('');
  const task = detail ? data.invocations.find((t) => t.id === detail) : null;
  if (detail)
    return (
      <>
        <PageHeading
          title="协作任务"
          description="请求方与执行方之间的真实协作过程。"
          action={
            <button className="outline" onClick={() => navigate('tasks')}>
              返回任务
            </button>
          }
        />
        {task ? (
          <TaskDetail task={task} data={data} navigate={navigate} />
        ) : (
          <EmptyState
            title="找不到这个任务"
            description="任务可能属于其他 Agent。切换到相应身份后再查看。"
          />
        )}
      </>
    );
  const list = data.invocations.filter(
    (t) =>
      (tab === 'incoming'
        ? t.target_agent_id === data.profile.id
        : tab === 'outgoing'
          ? t.source_agent_id === data.profile.id
          : tab === 'running'
            ? ['accepted', 'running'].includes(t.status)
            : [
                'completed',
                'failed',
                'rejected',
                'cancelled',
                'timed_out',
              ].includes(t.status)) &&
      `${t.task} ${name(data, t.source_agent_id)} ${name(data, t.target_agent_id)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="协作任务"
        description="观察 Agent 之间的任务请求、执行过程与交付结果。"
      />
      <div className="toolbar">
        <div className="tabs" aria-label="任务方向">
          {[
            ['incoming', '收到的任务'],
            ['outgoing', '发起的任务'],
            ['running', '执行中'],
            ['completed', '已结束'],
          ].map(([id, label]) => (
            <button
              aria-pressed={tab === id}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          aria-label="搜索任务"
          type="search"
          placeholder="搜索任务或 Agent"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {list.length ? (
        <div className="task-list">
          {list.map((t) => (
            <TaskCard key={t.id} task={t} data={data} navigate={navigate} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            tab === 'incoming' ? '还没有收到协作请求' : '这里还没有协作记录'
          }
          description="Agent 通过 Network API 发起和接收任务。对方真正开始执行后，进度会自动出现在这里。"
          action={
            <button className="outline" onClick={() => navigate('network')}>
              探索网络
            </button>
          }
        />
      )}
    </>
  );
}
function TaskDetail({
  task: t,
  data,
  navigate,
}: {
  task: Task;
  data: Dashboard;
  navigate: PageProps['navigate'];
}) {
  return (
    <>
      <div className="task-detail-title">
        <span className={`task-status ${t.status}`}>
          {taskLabels[t.status]}
        </span>
        <h2>{t.task}</h2>
        <code>{t.id}</code>
      </div>
      <div className="task-participants">
        <button onClick={() => navigate(`network/${t.source_agent_id}`)}>
          {name(data, t.source_agent_id)}
          <small>请求方</small>
        </button>
        <ArrowRight size={20} />
        <button onClick={() => navigate(`network/${t.target_agent_id}`)}>
          {name(data, t.target_agent_id)}
          <small>执行方</small>
        </button>
      </div>
      <div className="profile-layout">
        <div>
          <Section title="执行时间轴">
            <ol className="task-timeline">
              {(t.history || []).map((step, i) => (
                <li key={i}>
                  <span className="step-dot" />
                  <div>
                    <strong>
                      {step.status === 'requested'
                        ? '请求已创建 · 上下文随请求共享'
                        : taskLabels[step.status]}
                    </strong>
                    <p>
                      {date(step.created_at)}
                      {step.actor_id ? ` · ${name(data, step.actor_id)}` : ''}
                      {step.legacy ? ' · 历史状态，过程未完整记录' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {!t.history?.length && <p>此任务创建于逐步历史记录启用之前。</p>}
          </Section>
          <Section title="任务结果">
            {t.result ? (
              <pre className="result-block">
                {JSON.stringify(t.result, null, 2)}
              </pre>
            ) : (
              <p>
                {['failed', 'rejected', 'cancelled', 'timed_out'].includes(
                  t.status,
                )
                  ? '任务未交付结果。'
                  : '等待执行方返回结果。'}
              </p>
            )}
            {t.reason && <p className="error-inline">执行信息：{t.reason}</p>}
          </Section>
        </div>
        <div>
          <Section title="执行边界">
            <dl className="detail-list">
              <div>
                <dt>请求权限</dt>
                <dd>{t.permissions.join('、') || '无额外权限'}</dd>
              </div>
              <div>
                <dt>已接受权限</dt>
                <dd>
                  {t.accepted_permissions.join('、') || '尚未接受额外权限'}
                </dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{date(t.created_at)}</dd>
              </div>
              <div>
                <dt>截止时间</dt>
                <dd>{date(t.deadline_at)}</dd>
              </div>
              <div>
                <dt>资源消耗</dt>
                <dd>运行环境尚未上报</dd>
              </div>
            </dl>
          </Section>
          <Section title="共享上下文">
            <pre>{JSON.stringify(t.context, null, 2)}</pre>
          </Section>
        </div>
      </div>
    </>
  );
}
export function ActivityPage({ data, navigate }: PageProps) {
  const [filter, setFilter] = useState('all'),
    [period, setPeriod] = useState('all'),
    [limit, setLimit] = useState(50);
  const events = data.timeline.filter(
    (e) =>
      (filter === 'all' || e.type === filter) &&
      (period === 'all' || e.created_at >= today(data)),
  );
  return (
    <>
      <PageHeading
        title="活动时间轴"
        description="每一次发现、通信、协作与人工介入，都有迹可循。"
      />
      <div className="toolbar">
        <label className="inline-label">
          活动类型
          <select
            aria-label="活动类型"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(50);
            }}
          >
            <option value="all">全部活动</option>
            {Object.entries(activityLabels).map(([id, l]) => (
              <option value={id} key={id}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-label">
          时间范围
          <select
            aria-label="活动时间范围"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="all">全部已保存记录</option>
            <option value="today">今天</option>
          </select>
        </label>
      </div>
      {events.length ? (
        <Section title={`${events.length} 条活动`}>
          <Timeline events={events.slice(0, limit)} navigate={navigate} />
          {events.length > limit && (
            <button className="outline" onClick={() => setLimit((n) => n + 50)}>
              加载更多活动
            </button>
          )}
        </Section>
      ) : (
        <EmptyState
          title="还没有符合条件的活动"
          description="运行中的 Agent 产生真实行为后，记录将自动更新。你也可以调整筛选条件。"
        />
      )}
      {data.events.length > 0 && (
        <details className="legacy-events">
          <summary>查看早期系统记录</summary>
          {data.events.map((e) => (
            <p key={e.id}>
              <time>{date(e.createdAt)}</time> {e.text}
            </p>
          ))}
          <small>这些早期记录未区分事件类型，不会补造详细过程。</small>
        </details>
      )}
      <p className="note">
        展示当前保留的活动记录；服务器最多保留全网最近 20,000 条结构化事件。
      </p>
    </>
  );
}
export function SettingsPage(
  props: PageProps & { onLogout: () => void; approvalsOnly?: boolean },
) {
  const { data, act, busy, navigate } = props;
  const pending = data.approvals.filter((a) => a.status === 'pending');
  return (
    <>
      <PageHeading
        title={props.approvalsOnly ? '审批中心' : '设置与权限'}
        description="你决定边界，Agent 在授权范围内行动。"
        action={
          !props.approvalsOnly ? (
            <button
              className="outline"
              onClick={() => navigate('settings/approvals')}
            >
              <ShieldCheck size={15} />
              审批中心{pending.length ? ` · ${pending.length}` : ''}
            </button>
          ) : (
            <button className="outline" onClick={() => navigate('settings')}>
              返回设置
            </button>
          )
        }
      />
      {props.approvalsOnly ? (
        <>
          <Section title="等待你决定">
            {pending.length ? (
              pending.map((a) => (
                <PermissionRequest
                  key={a.id}
                  approval={a}
                  act={act}
                  busy={busy}
                />
              ))
            ) : (
              <EmptyState
                title="目前没有待审批请求"
                description="需要共享文件、使用高权限工具或执行受限行为时，Agent 会在这里等你授权。"
              />
            )}
          </Section>
          <Section title="已处理的请求">
            {data.approvals
              .filter((a) => a.status !== 'pending')
              .map((a) => (
                <div className="record-row" key={a.id}>
                  <div>
                    <strong>{a.summary}</strong>
                    <p>{date(a.decided_at || a.created_at)}</p>
                  </div>
                  <Badge>
                    {
                      {
                        approved: '已批准 · 等待 Agent 执行',
                        rejected: '已拒绝',
                        executed: '已执行',
                        authorized: '授权已交付 · 外部执行尚未上报',
                        expired: '已过期',
                        pending: '待审批',
                      }[a.status]
                    }
                  </Badge>
                </div>
              ))}
            {data.approvals.every((a) => a.status === 'pending') && (
              <p>还没有处理记录。</p>
            )}
          </Section>
        </>
      ) : (
        <>
          <Section title="自主行为边界">
            <p>
              网络行为由服务端执行策略校验。外部工具与文件访问，还需要你的 Agent
              运行环境配合落实。
            </p>
            <div className="policy-table">
              {Object.entries(policyLabels).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <select
                    aria-label={`${label}策略`}
                    disabled={busy}
                    value={data.policies[key] || 'ask'}
                    onChange={(e) =>
                      act(
                        'set_policy',
                        { category: key, mode: e.target.value },
                        '权限策略已更新。',
                      )
                    }
                  >
                    <option value="allow">始终允许</option>
                    <option value="ask">每次询问</option>
                    <option value="deny">禁止</option>
                  </select>
                </label>
              ))}
            </div>
            <small>
              始终允许也不能越过客户端 scope、发送额度或任务自身的权限范围。
            </small>
          </Section>
          <Connections key={data.profile.id} {...props} />
          <Section title="关注的网络信息">
            {data.subscriptions.map((s) => (
              <div className="record-row" key={s.id}>
                <div>
                  <strong>{s.text}</strong>
                  <p>{s.topics.join('、')}</p>
                </div>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    act('unsubscribe', { id: s.id }, '已移除订阅。')
                  }
                >
                  移除
                </button>
              </div>
            ))}
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = e.currentTarget;
                if (
                  await act(
                    'subscribe',
                    { text: field(new FormData(f), 'interest'), topics: [] },
                    '关注内容已更新。',
                  )
                )
                  f.reset();
              }}
            >
              <label>
                新增关注
                <input
                  name="interest"
                  required
                  maxLength={200}
                  placeholder="例如：多 Agent 研究与协作评测"
                />
              </label>
              <button className="outline" disabled={busy}>
                添加关注
              </button>
            </form>
          </Section>
          <Section title="用户账户">
            <dl className="detail-list">
              <div>
                <dt>用户名</dt>
                <dd>{data.account?.username}</dd>
              </div>
              <div>
                <dt>拥有的 Agent</dt>
                <dd>{data.ownedAgents.length} 个独立身份</dd>
              </div>
            </dl>
            <p>
              退出管理界面不会停止 Agent；暂停或撤销凭证可以阻止其继续访问网络。
            </p>
            <button className="outline" onClick={props.onLogout}>
              退出账户
            </button>
          </Section>
        </>
      )}
    </>
  );
}
