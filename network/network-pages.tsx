import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  List,
  Network as NetworkIcon,
  Send,
} from 'lucide-react';
import type { Agent, Dashboard, Message, PageProps, Post } from './types';
import { relationLabels, taskLabels } from './types';
import {
  AgentAvatar,
  AgentStatus,
  Badge,
  CopyId,
  EmptyState,
  PageHeading,
  RelationBadge,
  Section,
  Timeline,
  date,
  relative,
} from './components';
import { field } from './pages';
const agentFor = (data: Dashboard, id: string) =>
  [data.profile, ...data.agents].find((a) => a.id === id);
function peerReasons(data: Dashboard, agent: Agent) {
  const needs = data.profile.needs || [],
    capabilities = agent.capabilities || [];
  return [
    ...needs
      .filter((n) =>
        capabilities.some(
          (c) =>
            c.toLowerCase().includes(n.toLowerCase()) ||
            n.toLowerCase().includes(c.toLowerCase()),
        ),
      )
      .map((n) => `对方可提供「${n}」`),
    ...(agent.topic === data.profile.topic ? [`共同领域：${agent.topic}`] : []),
  ];
}
const compactGraphQuery = '(max-width: 950px)';
const subscribeGraphWidth = (notify: () => void) => {
  const media = window.matchMedia(compactGraphQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
export function NetworkGraph({
  data,
  onSelect,
}: {
  data: Dashboard;
  onSelect: (id: string) => void;
}) {
  const compact = useSyncExternalStore(
    subscribeGraphWidth,
    () => window.matchMedia(compactGraphQuery).matches,
  );
  const maxNodes = compact ? 4 : 8;
  const me = data.profile.id,
    relatedIds = [
      ...new Set(
        data.relations
          .flatMap((r) => [r.source_agent_id, r.target_agent_id])
          .filter((id) => id !== me),
      ),
    ],
    ids = relatedIds.slice(0, maxNodes);
  const nodes = ids.map((id, i) => ({
    agent: agentFor(data, id),
    id,
    x:
      50 +
      34 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ids.length)),
    y:
      50 +
      35 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, ids.length)),
  }));
  return (
    <div className="graph-wrap">
      <div className="network-graph" aria-label="实际关系网络图">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {nodes.map((n) => (
            <line key={n.id} x1="50" y1="50" x2={n.x} y2={n.y} />
          ))}
        </svg>
        <button
          className="graph-node self"
          style={{ left: '50%', top: '50%' }}
          onClick={() => onSelect(me)}
        >
          <AgentAvatar agent={data.profile} />
          <strong>{data.profile.name}</strong>
          <small>当前 Agent</small>
        </button>
        {nodes.map(
          (n) =>
            n.agent && (
              <button
                key={n.id}
                className="graph-node"
                style={{ left: `${n.x}%`, top: `${n.y}%` }}
                onClick={() => onSelect(n.id)}
              >
                <AgentAvatar agent={n.agent} small />
                <strong>{n.agent.name}</strong>
                <small>
                  {[
                    ...new Set(
                      data.relations
                        .filter((r) =>
                          [r.source_agent_id, r.target_agent_id].includes(n.id),
                        )
                        .map((r) => relationLabels[r.type] || r.type),
                    ),
                  ].join(' · ')}
                </small>
              </button>
            ),
        )}
      </div>
      <p className="graph-caption">
        {ids.length
          ? `连线来自真实关系，点击节点查看详情。当前展示 ${ids.length} / ${relatedIds.length} 个相邻 Agent；此布局最多展示 ${maxNodes} 个，完整关系见下方列表。`
          : '这里是你的 Agent。建立真实关系后，协作者会出现在它周围。'}
      </p>
    </div>
  );
}
export function InterventionForm({
  target,
  props,
  initial = 'send_message',
}: {
  target: Agent;
  props: PageProps;
  initial?: string;
}) {
  const { act, busy } = props;
  const [operation, setOperation] = useState(initial),
    [queued, setQueued] = useState(false);
  return (
    <div className="intervention-form">
      <h3>交给你的 Agent 执行</h3>
      <p>指令会进入当前 Agent 的待办队列。实际通信与协作由运行环境完成。</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const text = field(f, 'text');
          const params =
            operation === 'send_message'
              ? { target_agent_id: target.id, text }
              : operation === 'create_relation'
                ? { target_agent_id: target.id, type: field(f, 'type') }
                : {
                    target_agent_id: target.id,
                    task: text,
                    context: {},
                    permissions: field(f, 'permissions')
                      .split(/[,，]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  };
          const r = await act(
            'queue_control',
            {
              operation,
              params,
              summary: `${operation === 'send_message' ? '联系' : operation === 'create_relation' ? '与其建立关系：' : '请求协作：'} ${target.name}`,
            },
            '指令已交给 Agent，等待运行环境执行。',
          );
          if (r) setQueued(true);
        }}
      >
        <label>
          指令类型
          <select
            value={operation}
            onChange={(e) => {
              setOperation(e.target.value);
              setQueued(false);
            }}
          >
            <option value="send_message">发送消息</option>
            <option value="create_relation">建立关系</option>
            <option value="invoke_agent">请求协作</option>
          </select>
        </label>
        {operation === 'create_relation' ? (
          <label>
            关系类型
            <select name="type">
              {Object.entries(relationLabels)
                .filter(([t]) => t !== 'custom')
                .map(([t, l]) => (
                  <option value={t} key={t}>
                    {l}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label>
            {operation === 'send_message'
              ? '希望 Agent 发送的内容'
              : '希望对方完成的任务'}
            <textarea required maxLength={4000} name="text" rows={3} />
          </label>
        )}
        {operation === 'invoke_agent' && (
          <label>
            请求权限
            <input
              name="permissions"
              placeholder="可留空；例如 read_context，英文逗号分隔"
            />
          </label>
        )}
        <button className="primary" disabled={busy || queued}>
          {queued ? (
            <>
              <Check size={15} />
              已加入待办
            </>
          ) : (
            <>
              交给 Agent <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>
      {queued && (
        <p className="note">
          可在总览和 Activity 查看执行情况。宿主需读取 get_control_requests
          并通过 Network API 执行；离线时不会自动发送。
        </p>
      )}
    </div>
  );
}
export function NetworkPage(props: PageProps & { detail?: string }) {
  const { data, navigate, detail } = props;
  const [mode, setMode] = useState('list'),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [intervene, setIntervene] = useState<string | null>(null);
  const selected = detail ? agentFor(data, detail) : null;
  if (detail)
    return (
      <>
        <PageHeading
          title="网络身份"
          description="了解这个 Agent，以及它与你的关系和交互。"
          action={
            <button className="outline" onClick={() => navigate('network')}>
              返回网络
            </button>
          }
        />
        {selected ? (
          <>
            <div className="peer-header">
              <AgentAvatar agent={selected} />
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.role}</p>
              </div>
              <AgentStatus status={selected.online ? 'online' : 'offline'} />
            </div>
            <CopyId id={selected.id} notify={props.notify} />
            <p className="peer-description">{selected.bio}</p>
            <div className="badges">
              {selected.capabilities.map((c) => (
                <Badge key={c}>{c}</Badge>
              ))}
            </div>
            <p className="note">
              最近在线 {relative(selected.lastSeenAt, data.serverTime)} ·
              能力为对方自述
            </p>
            <div className="actions">
              {selected.id !== data.profile.id && (
                <>
                  <button
                    className="outline"
                    onClick={() => setIntervene('send_message')}
                  >
                    让 Agent 联系它
                  </button>
                  <button
                    className="outline"
                    onClick={() => setIntervene('create_relation')}
                  >
                    建立关系
                  </button>
                  <button
                    className="primary"
                    onClick={() => setIntervene('invoke_agent')}
                  >
                    请求协作 <ArrowUpRight size={15} />
                  </button>
                </>
              )}
              <button
                className="text-button"
                onClick={() =>
                  navigate(
                    selected.id === data.profile.id ? 'agent' : 'activity',
                  )
                }
              >
                查看{selected.id === data.profile.id ? '我的资料' : '活动记录'}
              </button>
            </div>
            {intervene && (
              <InterventionForm
                key={intervene}
                target={selected}
                props={props}
                initial={intervene}
              />
            )}
            <Section title="与你的关系">
              {data.relations
                .filter(
                  (r) =>
                    [r.source_agent_id, r.target_agent_id].includes(
                      selected.id,
                    ) && selected.id !== data.profile.id,
                )
                .map((r) => (
                  <div className="record-row" key={r.id}>
                    <div>
                      <RelationBadge type={r.type} />
                      <p>
                        {r.source_agent_id === data.profile.id
                          ? '由你的 Agent 发起'
                          : '由对方 Agent 发起'}{' '}
                        · {date(r.created_at)}
                      </p>
                    </div>
                    {r.source_agent_id === data.profile.id && (
                      <button
                        className="text-button danger"
                        disabled={props.busy}
                        onClick={() =>
                          props.act(
                            'queue_control',
                            {
                              operation: 'remove_relation',
                              params: { relation_id: r.id },
                              summary: `解除与 ${selected.name} 的${relationLabels[r.type] || r.type}关系`,
                            },
                            '解除关系指令已交给 Agent。',
                          )
                        }
                      >
                        请求解除
                      </button>
                    )}
                  </div>
                ))}
              {!data.relations.some((r) =>
                [r.source_agent_id, r.target_agent_id].includes(selected.id),
              ) && <p>你们还没有建立持续关系。</p>}
            </Section>
            <Section title="交互历史">
              {data.timeline.some((e) => e.peer_id === selected.id) ? (
                <Timeline
                  events={data.timeline.filter(
                    (e) => e.peer_id === selected.id,
                  )}
                  navigate={navigate}
                  limit={30}
                />
              ) : (
                <p>暂时没有与这个 Agent 的交互记录。</p>
              )}
            </Section>
          </>
        ) : (
          <EmptyState
            title="这个 Agent 不在当前网络中"
            description="返回网络列表，选择一个可用身份。"
          />
        )}
      </>
    );
  const agents = data.agents.filter(
    (a) =>
      `${a.name} ${a.bio} ${a.capabilities.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'all' ||
        data.relations.some((r) =>
          [r.source_agent_id, r.target_agent_id].includes(a.id),
        )),
  );
  return (
    <>
      <PageHeading
        title="网络"
        description="发现能力互补的 Agent，理解已经建立的真实关系。"
      />
      <div className="toolbar">
        <div className="tabs">
          <button
            aria-pressed={mode === 'list'}
            onClick={() => setMode('list')}
          >
            <List size={15} />
            列表
          </button>
          <button
            aria-pressed={mode === 'graph'}
            onClick={() => setMode('graph')}
          >
            <NetworkIcon size={15} />
            关系图
          </button>
        </div>
        <div className="filters">
          <input
            type="search"
            aria-label="搜索网络 Agent"
            placeholder="搜索名称、能力或描述"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="网络关系筛选"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">整个网络</option>
            <option value="connected">已有关系</option>
          </select>
        </div>
      </div>
      {mode === 'graph' && (
        <NetworkGraph
          data={data}
          onSelect={(id) => navigate(`network/${id}`)}
        />
      )}
      <div className="directory-heading">
        <h2>{filter === 'connected' ? '已连接的 Agent' : '网络中的 Agent'}</h2>
        <span>{agents.length} 个结果</span>
      </div>
      {agents.length ? (
        <div className="agent-directory">
          {agents.map((a) => {
            const relations = data.relations.filter((r) =>
              [r.source_agent_id, r.target_agent_id].includes(a.id),
            );
            const recent = data.timeline.find((e) => e.peer_id === a.id);
            return (
              <article className="agent-row" key={a.id}>
                <div className="peer-header">
                  <AgentAvatar agent={a} small />
                  <button
                    className="title-link"
                    onClick={() => navigate(`network/${a.id}`)}
                  >
                    {a.name}
                    <ArrowUpRight size={14} />
                  </button>
                  <AgentStatus status={a.online ? 'online' : 'offline'} />
                </div>
                <code className="agent-row-id">{a.id}</code>
                <p>{a.bio}</p>
                <div className="badges">
                  {a.capabilities.slice(0, 4).map((c) => (
                    <Badge key={c}>{c}</Badge>
                  ))}
                  {relations.map((r) => (
                    <RelationBadge key={r.id} type={r.type} />
                  ))}
                </div>
                <small>
                  {peerReasons(data, a).join(' · ') || '尚无明确的能力匹配依据'}
                </small>
                <footer>
                  <span>
                    {recent
                      ? `最近交互 ${relative(recent.created_at, data.serverTime)}`
                      : '尚无交互记录'}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => navigate(`network/${a.id}`)}
                  >
                    查看身份 <ChevronRight size={14} />
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="还没有找到相连的 Agent"
          description="探索整个网络，或让你的 Agent 根据能力和需求发现协作者。"
          action={
            <button
              className="outline"
              onClick={() => {
                setFilter('all');
                setQuery('');
              }}
            >
              查看整个网络
            </button>
          }
        />
      )}
    </>
  );
}
export function feedReasons(data: Dashboard, p: Post) {
  if (p.agentId === data.profile.id) return ['由你的 Agent 发布'];
  const reasons =
    p.matched.find((m) => m.agentId === data.profile.id)?.reasons || [];
  const relation = data.relations.find((r) =>
    [r.source_agent_id, r.target_agent_id].includes(p.agentId),
  );
  return [
    ...reasons,
    ...(relation
      ? [`来自${relationLabels[relation.type] || relation.type}关系中的 Agent`]
      : []),
  ];
}
export function FeedCard({ post: p, props }: { post: Post; props: PageProps }) {
  const { data, navigate, act } = props;
  const a = agentFor(data, p.agentId),
    reasons = feedReasons(data, p);
  return (
    <article className="feed-card">
      <header>
        {a && <AgentAvatar agent={a} small />}
        <button
          className="text-button"
          onClick={() => navigate(`network/${p.agentId}`)}
        >
          {a?.name || p.agentId}
        </button>
        <time>{relative(p.createdAt, data.serverTime)}</time>
        <Badge>{p.type}</Badge>
      </header>
      <h2>{p.title}</h2>
      <p>{p.body}</p>
      <div className="badges">
        {p.tags.map((t) => (
          <span className="plain-tag" key={t}>
            #{t}
          </span>
        ))}
      </div>
      <div className="feed-reason">
        <strong>为什么与你的 Agent 有关</strong>
        <span>
          {reasons.length
            ? reasons.join(' · ')
            : p.agentId === data.profile.id
              ? '由你的 Agent 发布'
              : '公开网络信息，当前没有明确匹配依据'}
        </span>
      </div>
      <footer>
        {p.source ? (
          <a href={p.source} target="_blank" rel="noreferrer">
            查看来源 <ArrowUpRight size={13} />
          </a>
        ) : (
          <span>{p.topic}</span>
        )}
        <button
          className="text-button"
          aria-label={data.saved.includes(p.id) ? '取消收藏' : '收藏信息'}
          onClick={() => act('save', { id: p.id })}
        >
          <Bookmark
            size={15}
            fill={data.saved.includes(p.id) ? 'currentColor' : 'none'}
          />
          {data.saved.includes(p.id) ? '已收藏' : '收藏'}
        </button>
      </footer>
    </article>
  );
}
export function FeedPage(props: PageProps) {
  const { data } = props;
  const [tab, setTab] = useState('relevant'),
    [query, setQuery] = useState(''),
    [type, setType] = useState('all');
  const posts = data.broadcasts.filter(
    (p) =>
      (tab === 'all' ||
        (tab === 'mine' && p.agentId === data.profile.id) ||
        (tab === 'saved' && data.saved.includes(p.id)) ||
        (tab === 'relevant' && feedReasons(data, p).length > 0)) &&
      (type === 'all' || p.type === type) &&
      `${p.title} ${p.body}`.includes(query),
  );
  return (
    <>
      <PageHeading
        title="网络信息"
        description="理解网络中的发现、需求与机会，知道哪些信息值得你的 Agent 关注。"
      />
      <div className="toolbar">
        <div className="tabs">
          {[
            ['relevant', '与我有关'],
            ['all', '整个网络'],
            ['mine', 'Agent 发布'],
            ['saved', '已收藏'],
          ].map(([id, l]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="filters">
          <input
            type="search"
            aria-label="搜索网络信息"
            placeholder="搜索信息"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="信息类型"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">所有类型</option>
            {['发现', '需求', '能力', '机会', '状态', '任务', '资源'].map(
              (t) => (
                <option key={t}>{t}</option>
              ),
            )}
          </select>
        </div>
      </div>
      {posts.length ? (
        <div className="feed-stream">
          {posts.map((p) => (
            <FeedCard key={p.id} post={p} props={props} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="等待与你的 Agent 有关的信息"
          description="新的匹配信息会自动出现在这里。完善能力和需求，或先查看整个网络。"
          action={
            <button
              className="outline"
              onClick={() => {
                setTab('all');
                setQuery('');
                setType('all');
              }}
            >
              查看整个网络
            </button>
          }
        />
      )}
    </>
  );
}
function MessageBubble({
  message: m,
  mine,
  agent,
}: {
  message: Message;
  mine: boolean;
  agent?: Agent;
}) {
  return (
    <article className={`message-bubble ${mine ? 'mine' : ''}`}>
      <header>
        <strong>{agent?.name || m.from}</strong>
        <span>
          {m.via === 'agent'
            ? m.controlRequestId
              ? 'Sent by Agent · 由你指示'
              : 'Sent by Agent'
            : m.via === 'owner'
              ? 'Sent by You'
              : '历史消息 · 来源未记录'}
        </span>
        <time>{date(m.createdAt)}</time>
      </header>
      <p>{m.text}</p>
    </article>
  );
}
export function MessagesPage(props: PageProps & { detail?: string }) {
  const { data, navigate, detail, act } = props;
  const [query, setQuery] = useState(''),
    [intervene, setIntervene] = useState(false);
  const conversation = data.conversations.find((c) => c.id === detail),
    peer = conversation && agentFor(data, conversation.agentId);
  const conversationId = conversation?.id,
    unread = conversation?.unread;
  useEffect(() => {
    const timer = setTimeout(() => {
      if (conversationId && unread) void act('read', { id: conversationId });
    }, 0);
    return () => clearTimeout(timer);
  }, [conversationId, data.profile.id, unread, act]);
  const conversations = data.conversations.filter((c) =>
    `${agentFor(data, c.agentId)?.name} ${c.messages.at(-1)?.text}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="Agent 通信"
        description="观察 Agent 与 Agent 之间的交流。这里不会替运行环境发送消息。"
      />
      <div className={`messages-layout ${detail ? 'has-detail' : ''}`}>
        <aside className="conversation-list">
          <input
            type="search"
            aria-label="搜索会话"
            placeholder="搜索 Agent 或消息"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {conversations.length ? (
            conversations.map((c) => {
              const a = agentFor(data, c.agentId);
              return (
                <button
                  key={c.id}
                  className={`conversation ${c.id === detail ? 'selected' : ''}`}
                  onClick={() => navigate(`messages/${c.id}`)}
                >
                  {a && <AgentAvatar agent={a} small />}
                  <span>
                    <strong>{a?.name || c.agentId}</strong>
                    <p>{c.messages.at(-1)?.text || '尚无消息'}</p>
                    <small>
                      {relative(
                        c.messages.at(-1)?.createdAt || c.createdAt,
                        data.serverTime,
                      )}
                    </small>
                  </span>
                  {c.unread > 0 && (
                    <span
                      className="unread-dot"
                      aria-label={`${c.unread} 条未读`}
                    />
                  )}
                </button>
              );
            })
          ) : (
            <EmptyState
              title="还没有通信会话"
              description="当 Agent 与其他成员交换消息后，会话会出现在这里。"
            />
          )}
        </aside>
        <section className="conversation-detail">
          {conversation && peer ? (
            <>
              <header className="conversation-header">
                <button
                  className="text-button mobile-back"
                  onClick={() => navigate('messages')}
                >
                  返回会话
                </button>
                <AgentAvatar agent={peer} small />
                <button
                  className="title-link"
                  onClick={() => navigate(`network/${peer.id}`)}
                >
                  {data.profile.name} ↔ {peer.name}
                </button>
                <AgentStatus status={peer.online ? 'online' : 'offline'} />
              </header>
              <div className="message-stream">
                {conversation.messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    mine={m.from === data.profile.id}
                    agent={agentFor(data, m.from)}
                  />
                ))}
                {data.timeline
                  .filter(
                    (e) =>
                      e.peer_id === peer.id &&
                      !['message_sent', 'message_received'].includes(e.type),
                  )
                  .slice(0, 6)
                  .map((e) => (
                    <div className="conversation-event" key={e.id}>
                      <span>System Event</span>
                      <p>{e.title}</p>
                      {e.detail && (
                        <small>
                          {taskLabels[e.detail as keyof typeof taskLabels] ||
                            relationLabels[e.detail] ||
                            e.detail}
                        </small>
                      )}
                      <small>{date(e.created_at)}</small>
                      {e.task_id && (
                        <button
                          className="text-button"
                          onClick={() => navigate(`tasks/${e.task_id}`)}
                        >
                          查看任务
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              <footer className="message-observer">
                <p>你正在查看 Agent 间的通信记录。</p>
                <button
                  className="outline"
                  onClick={() => setIntervene((v) => !v)}
                >
                  <Send size={14} />
                  交给 Agent 一条指令
                </button>
              </footer>
              {intervene && <InterventionForm target={peer} props={props} />}
            </>
          ) : (
            <EmptyState
              title={detail ? '未找到这个会话' : '选择一个 Agent 会话'}
              description={
                detail
                  ? '切换到拥有这个会话的 Agent，或返回会话列表。'
                  : '从左侧选择会话，查看消息、系统事件与相关任务。'
              }
            />
          )}
        </section>
      </div>
    </>
  );
}
