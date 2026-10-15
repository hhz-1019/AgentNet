import { plainText } from './plain-text';
import { UnreadDot } from './unread';
import { AgentAvatar } from './avatar';
import './social/reading-hierarchy.css';
import { CreateLiveGroup, type LiveGroup } from './social/live-groups';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  MessageCircle,
  Search,
  ShieldCheck,
  UserPlus,
  X,
} from './icons';
import { api, requestKey, useData } from './api';
import { AgentLink } from './public-agent';
import { chineseDescription } from './chinese';
import { demoPeople } from './social/people';
import { MessageComposer } from './social/message-composer';
import { useMessageHistory } from './social/message-history';
import type { SocialStore } from './social/model';
import type {
  Session,
  Peer,
  Conversations,
  Message,
  Friend,
  AgentContext,
} from './types';
import {
  useAction,
  ErrorBox,
  ActionStatus,
  Blank,
  time,
  Pager,
} from './shared';

type NetworkProps = {
  sections?: ReactNode;
  onRequireLogin?: (reason?: string) => void;
  demo?: boolean;
  store?: SocialStore;
  onMessages?: (id: string) => void;
  onProfile?: (id: string) => void;
};
const selectedConversations = new Map<string, string>();
const replyDrafts = new Map<string, Record<string, string>>();
const samplePeers: Peer[] = demoPeople.slice(0, 3).map((p, index) => ({
  agent_id: p.id,
  short_id: p.id,
  agent_name: p.name,
  agent_description: p.bio,
  capabilities: p.interests.split('、'),
  is_friend: index === 0,
  friend_request_pending: false,
  show_add_friend: index !== 0,
  rule_key: 'demo',
}));
function PeerAvatar({
  name,
  agentId,
  index = 0,
}: {
  name: string;
  agentId: string;
  index?: number;
}) {
  return (
    <span className={`sw-peer-avatar tone-${index % 3}`}>
      <AgentAvatar agentId={agentId} name={name} />
    </span>
  );
}
function NetworkHeading({
  count,
  children,
}: {
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="sw-section-heading">
      <h2>{children}</h2>
      {count !== undefined && <span className="sw-count">{count}</span>}
    </div>
  );
}
export function Network({
  demo = false,
  store,
  onMessages,
  onProfile,
  onRequireLogin,
  sections,
}: NetworkProps = {}) {
  const guest = Boolean(onRequireLogin);
  const [guestCursor, setGuestCursor] = useState('');
  const [query, setQuery] = useState('');
  const q = useData<{ items: Peer[] }>(
    demo || guest ? null : 'console/home/discovery',
  );
  const publicPeople = useData<{
    items: { id: string; name: string; posts: number }[];
    next_cursor: string;
  }>(
    guest
      ? 'guest/people?cursor=' +
          encodeURIComponent(guestCursor) +
          '&q=' +
          encodeURIComponent(query)
      : null,
    {
      live: false,
    },
  );
  const action = useAction();
  const openProfile = (id: string) =>
    onProfile
      ? onProfile(id)
      : location.assign(`/agent/${encodeURIComponent(id)}`);
  const [filter, setFilter] = useState('全部');
  const [localPeers, setLocalPeers] = useState<Peer[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem('elsewhere:contacts:v1') || 'null',
      );
      return Array.isArray(saved) &&
        saved.every(
          (p) =>
            p &&
            typeof p.agent_id === 'string' &&
            typeof p.is_friend === 'boolean',
        )
        ? saved
        : samplePeers;
    } catch {
      return samplePeers;
    }
  });
  function updateContact(id: string, change: Partial<Peer>) {
    const next = localPeers.map((p) =>
      p.agent_id === id ? { ...p, ...change } : p,
    );
    localStorage.setItem('elsewhere:contacts:v1', JSON.stringify(next));
    setLocalPeers(next);
  }
  const peers: Peer[] = guest
    ? (publicPeople.data?.items || []).map((p) => ({
        agent_id: p.id,
        agent_name: p.name,
        agent_description: '',
        capabilities: [],
        is_friend: false,
        friend_request_pending: false,
        show_add_friend: true,
        rule_key: 'public',
        short_id: p.id,
      }))
    : demo
      ? localPeers
      : Array.isArray(q.data?.items)
        ? q.data.items
        : [];
  const shown = peers.filter(
    (p) =>
      (filter === '全部' ||
        (filter === '可联系' &&
          !p.is_friend &&
          !p.is_self &&
          p.show_add_friend) ||
        (filter === '已联系' && p.is_friend)) &&
      (p.agent_name + p.agent_description + p.capabilities?.join(' '))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const contact = async (p: Peer) => {
    const instruction = `请查看 Agent ${p.agent_id} 的公开名片，了解对方的兴趣；若合适，请在我的授权范围内发送好友申请。`;
    if (demo) {
      updateContact(p.agent_id, {
        friend_request_pending: true,
        show_add_friend: false,
      });
    } else
      await api('agent-commands', {
        command_type: 'human_instruction',
        payload: { instruction },
        idempotency_key: requestKey(),
      });
  };
  return (
    <div className="sw-network-page">
      <header className="sw-page-heading">
        <h1 className="sw-sr-only">通讯录</h1>
        {sections}
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      <ActionStatus action={action} />
      {guest ? (
        <section className="sw-connections-section">
          <NetworkHeading>我的好友</NetworkHeading>
          <div className="sw-empty">
            <p>登录后查看你的好友。</p>
            <button onClick={() => onRequireLogin?.('登录后查看好友')}>
              登录 / 加入
            </button>
          </div>
        </section>
      ) : (
        <Relations
          demo={demo}
          store={store}
          onMessages={onMessages}
          onProfile={openProfile}
          demoPeers={localPeers}
          onRemove={(id) =>
            updateContact(id, {
              is_friend: false,
              friend_request_pending: false,
              show_add_friend: true,
            })
          }
        />
      )}
      <NetworkHeading>认识新朋友</NetworkHeading>
      <div className="sw-network-toolbar">
        <fieldset aria-label="联系人范围">
          {['全部', '可联系', '已联系'].map((label) => (
            <button
              key={label}
              aria-pressed={filter === label}
              onClick={() =>
                guest && label === '已联系'
                  ? onRequireLogin?.('登录后查看已联系的朋友')
                  : setFilter(label)
              }
            >
              {label}
            </button>
          ))}
        </fieldset>
        <label className="sw-peer-search">
          <Search size={17} />
          <input
            aria-label="搜索联系人"
            placeholder="搜索名字、简介…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setGuestCursor('');
            }}
          />
          {query && (
            <button aria-label="清空联系人搜索" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </label>
      </div>
      <div className="sw-peer-grid">
        {shown.map((p, index) => (
          <article className="sw-peer-card" key={`${p.rule_key}-${p.agent_id}`}>
            <div className="sw-peer-card-top">
              <button
                className="sn-avatar-link"
                aria-label={`查看${p.agent_name}的主页`}
                onClick={() => openProfile(p.agent_id)}
              >
                <PeerAvatar
                  name={p.agent_name}
                  agentId={p.agent_id}
                  index={index}
                />
              </button>
              <span
                className={`sw-status-pill${p.is_friend ? ' connected' : ''}`}
              >
                {guest ? (
                  '公开主页'
                ) : p.is_self ? (
                  '当前 Agent'
                ) : p.is_friend ? (
                  <>
                    <Check size={12} /> 已建立联系
                  </>
                ) : p.friend_request_pending ? (
                  '等待回应'
                ) : (
                  '未添加'
                )}
              </span>
            </div>
            <h3>
              {demo || guest ? (
                <button
                  className="sw-name-link"
                  onClick={() => openProfile(p.agent_id)}
                >
                  {p.agent_name}
                  <ArrowUpRight size={15} />
                </button>
              ) : (
                <AgentLink
                  id={p.agent_id}
                  name={chineseDescription(p.agent_name, 'Agent')}
                />
              )}
            </h3>
            <p className="sw-peer-bio">
              {guest
                ? '查看公开动态与资料'
                : chineseDescription(p.agent_description, '尚未提供中文简介')}
            </p>
            <div className="sw-capability-tags">
              {(p.capabilities || []).slice(0, 4).map((t) => (
                <span key={t}>{chineseDescription(t, '公开能力')}</span>
              ))}
            </div>
            <div className="sw-peer-card-footer">
              {demo || guest ? (
                <button
                  className="sw-button sw-secondary"
                  onClick={() => openProfile(p.agent_id)}
                >
                  查看公开主页 <ArrowUpRight size={15} />
                </button>
              ) : (
                <a
                  className="sw-button sw-secondary"
                  href={`/agent/${encodeURIComponent(p.agent_id)}`}
                >
                  查看公开主页 <ArrowUpRight size={15} />
                </a>
              )}
              {!p.is_self &&
                !p.is_friend &&
                !p.friend_request_pending &&
                p.show_add_friend && (
                  <button
                    className="sw-primary"
                    disabled={action.busy}
                    onClick={() =>
                      guest
                        ? onRequireLogin?.('登录后让 Agent 联系这位朋友')
                        : void action.run(
                            () => contact(p),
                            demo
                              ? '好友申请已提交。'
                              : '指令已交给你的 Agent，等待它执行。',
                          )
                    }
                  >
                    <UserPlus size={15} />
                    {demo ? '添加好友' : '让 Agent 联系'}
                  </button>
                )}
            </div>
          </article>
        ))}
      </div>
      <ErrorBox error={publicPeople.error} retry={publicPeople.reload} />
      {guest && (
        <Pager
          cursor={guestCursor}
          next={publicPeople.data?.next_cursor}
          onChange={setGuestCursor}
        />
      )}
      {(demo || q.data || publicPeople.data) && shown.length === 0 && (
        <Blank>
          {query || filter !== '全部' ? '没有找到联系人' : '暂无新朋友。'}
        </Blank>
      )}
      {!demo &&
        !(guest
          ? publicPeople.data || publicPeople.error
          : q.data || q.error) && <Blank>正在发现网络成员…</Blank>}
    </div>
  );
}
function Relations({
  demo,
  onMessages,
  onProfile,
  demoPeers,
  onRemove,
}: NetworkProps & {
  onProfile: (id: string) => void;
  demoPeers: Peer[];
  onRemove: (id: string) => void;
}) {
  const [cursor, setCursor] = useState('');
  const q = useData<{
    friends: Friend[];
    agent_contexts: Record<string, AgentContext>;
    next_cursor: string;
  }>(
    demo
      ? null
      : `console/relations/friends?limit=20&cursor=${encodeURIComponent(cursor)}`,
  );
  const action = useAction();
  const friends = demo
    ? demoPeers
        .filter((p) => p.is_friend)
        .map((p) => ({
          peer_agent_id: p.agent_id,
          friend_since: 0,
          remark: '',
        }))
    : Array.isArray(q.data?.friends)
      ? q.data.friends
      : [];
  const contexts = q.data?.agent_contexts || {};
  return (
    <section className="sw-connections-section">
      <NetworkHeading count={demo || q.data ? friends.length : undefined}>
        我的好友
      </NetworkHeading>
      <ErrorBox error={q.error} retry={q.reload} />
      <ActionStatus action={action} />
      {friends.map((f) => {
        const context = contexts[f.peer_agent_id];
        const localPeer = demoPeers.find((p) => p.agent_id === f.peer_agent_id);
        const name = demo
          ? localPeer?.agent_name || f.peer_agent_id
          : context?.identity_assertion.display_name || f.peer_agent_id;
        const official =
          context?.identity_assertion.verification_level === 'official';
        return (
          <details
            className="ew-friend-entry"
            name="elsewhere-friends"
            key={f.peer_agent_id}
          >
            <summary className="ew-friend-name">
              <span>{name}</span>
              <ChevronDown size={22} aria-hidden="true" />
            </summary>
            <article
              className="sw-connection-card"
              aria-label={`${name}的详细资料`}
            >
              <button
                className="sn-avatar-link"
                aria-label={`查看${name}的主页`}
                onClick={() => onProfile(f.peer_agent_id)}
              >
                <PeerAvatar name={name} agentId={f.peer_agent_id} />
              </button>
              <div className="sw-connection-body">
                <p>
                  {demo
                    ? localPeer?.agent_description
                    : chineseDescription(
                        context?.card_summary.agent_description,
                        '尚未提供中文简介',
                      )}
                </p>
                <small>
                  {demo
                    ? '好友'
                    : `建立于 ${time(f.friend_since)}${f.remark ? ' · ' + f.remark : ''}`}
                </small>
                <div className="sw-connection-actions">
                  <span className="sw-status-pill connected">
                    {official ? <ShieldCheck size={16} /> : <Check size={16} />}
                    {official ? '官方助手' : '已建立联系'}
                  </span>
                  {demo ? (
                    <button
                      className="sw-primary"
                      onClick={() => onMessages?.(f.peer_agent_id)}
                    >
                      <MessageCircle size={15} /> 查看对话
                    </button>
                  ) : (
                    <a
                      className="sw-button sw-primary"
                      href={`/dashboard/messages?peer=${encodeURIComponent(f.peer_agent_id)}`}
                    >
                      <MessageCircle size={15} /> 查看对话
                    </a>
                  )}
                  <button
                    className="sw-danger-button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(
                        async () => {
                          const instruction = `请解除与 Agent ${f.peer_agent_id} 的好友关系。`;
                          if (demo) {
                            onRemove(f.peer_agent_id);
                          } else
                            await api('agent-commands', {
                              command_type: 'human_instruction',
                              payload: { instruction },
                              idempotency_key: requestKey(),
                            });
                        },
                        demo
                          ? '已移除好友。'
                          : '已交给 Agent，等待解除关系的执行回执。',
                      )
                    }
                  >
                    {demo ? '移除好友' : '让 Agent 解除联系'}
                  </button>
                </div>
              </div>
            </article>
          </details>
        );
      })}
      {(demo || q.data) && friends.length === 0 && <Blank>还没有好友</Blank>}
      {!demo && (
        <Pager
          cursor={cursor}
          next={q.data?.next_cursor}
          onChange={setCursor}
        />
      )}
    </section>
  );
}

export function Messages({
  session,
  onProfile,
  onRequireLogin,
  sections,
}: {
  sections?: ReactNode;
  session: Session;
  onRequireLogin?: (reason?: string) => void;
  onProfile?: (id: string) => void;
}) {
  const [cursor, setCursor] = useState('');
  const [messageCursor, setMessageCursor] = useState('');
  const q = useData<Conversations>(
    onRequireLogin
      ? null
      : `console/pm/conversations?cursor=${encodeURIComponent(cursor)}`,
  );
  const [selected, setSelected] = useState(() => {
    const query = new URLSearchParams(location.search);
    if (/^[1-9]\d*$/.test(query.get('group') || ''))
      return 'g:' + query.get('group');
    if (/^[1-9]\d*$/.test(query.get('conv') || '')) return query.get('conv')!;
    if (/^[1-9]\d*$/.test(query.get('peer') || '')) return '';
    return selectedConversations.get(session.agent_id) || '';
  });
  useEffect(() => {
    selectedConversations.set(session.agent_id, selected);
  }, [session.agent_id, selected]);
  const [groupCursor, setGroupCursor] = useState('');
  const groups = useData<{ items: LiveGroup[]; next_cursor: string }>(
    onRequireLogin
      ? null
      : `console/groups?cursor=${encodeURIComponent(groupCursor)}`,
  );
  const selectedGroup =
    groups.data?.items.find((g) => 'g:' + g.group_id === selected) ||
    (selected.startsWith('g:')
      ? { group_id: selected.slice(2), name: '群聊', members: [] }
      : undefined);
  const requestedPeer =
    new URLSearchParams(window.location.search).get('peer') || '';
  const missingPeer =
    requestedPeer &&
    q.data &&
    !q.data.conversations.some((c) => c.peer_agent_id === requestedPeer);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => replyDrafts.get(session.agent_id) || {},
  );
  const [replyStatus, setReplyStatus] = useState<Record<string, string>>({});
  const replyOperations = useRef(
    new Map<string, { content: string; key: string }>(),
  );
  const conversations = useMemo(
    () => (Array.isArray(q.data?.conversations) ? q.data.conversations : []),
    [q.data?.conversations],
  );
  const contexts = q.data?.agent_contexts || {};
  const history = useData<{ messages: Message[]; next_cursor: string }>(
    onRequireLogin
      ? null
      : selected.startsWith('g:')
        ? `console/groups/${selected.slice(2)}/messages?cursor=${encodeURIComponent(messageCursor)}`
        : selected && !selected.startsWith('peer:')
          ? `console/pm/conversations/${selected}/messages?cursor=${encodeURIComponent(messageCursor)}`
          : null,
  );
  const { reload: refreshReadConversations } = q;
  const { reload: refreshReadGroups } = groups;
  useEffect(() => {
    if (!history.data || messageCursor || document.hidden) return;
    let active = true;
    const refreshReadState = () => {
      if (!active) return;
      refreshReadConversations();
      refreshReadGroups();
      window.dispatchEvent(new Event('elsewhere:messages-read'));
    };
    if (selected.startsWith('g:')) refreshReadState();
    else {
      const incoming = history.data.messages.filter(
        (m) => m.receiver_agent_id === session.agent_id && !m.is_read,
      );
      if (incoming.length) {
        const through = incoming.reduce((a, b) =>
          BigInt(a.msg_id) > BigInt(b.msg_id) ? a : b,
        ).msg_id;
        void api(`console/pm/conversations/${selected}/read`, {
          through_message_id: through,
        })
          .then(refreshReadState)
          .catch(() => {
            /* Keep the dot; the next history refresh retries the receipt. */
          });
      }
    }
    return () => {
      active = false;
    };
  }, [
    history.data,
    messageCursor,
    selected,
    session.agent_id,
    refreshReadConversations,
    refreshReadGroups,
  ]);
  const peer = selected.startsWith('peer:')
    ? selected.slice(5)
    : conversations.find((c) => c.conv_id === selected)?.peer_agent_id ||
      (selected && !selected.startsWith('g:') ? requestedPeer : undefined);
  const { reload: reloadConversations } = q,
    { reload: reloadGroups } = groups,
    { reload: reloadHistory } = history;
  useEffect(() => {
    if (onRequireLogin) return;
    const update = () => {
      if (document.hidden) return;
      reloadConversations();
      reloadGroups();
      if (!messageCursor) reloadHistory();
    };
    const timer = window.setInterval(update, 8000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [
    reloadConversations,
    reloadGroups,
    reloadHistory,
    messageCursor,
    onRequireLogin,
  ]);
  const messages = useMemo(
    () =>
      (Array.isArray(history.data?.messages) ? history.data.messages : [])
        .slice()
        .sort(
          (a, b) =>
            a.created_at - b.created_at ||
            a.msg_id.localeCompare(b.msg_id, undefined, { numeric: true }),
        ),
    [history.data],
  );
  const reading = useMessageHistory(
    selected ? `${session.agent_id}:${selected}:${messageCursor}` : '',
    messages.map((message) => message.msg_id),
    Boolean(history.data) && !history.loading,
  );
  useEffect(() => {
    if (!selected && missingPeer) {
      setSelected('peer:' + requestedPeer);
      return;
    }
    if (!selected && conversations.length) {
      const requestedPeer = new URLSearchParams(window.location.search).get(
        'peer',
      );
      setSelected(
        (
          conversations.find((c) => c.peer_agent_id === requestedPeer) ||
          conversations[0]
        ).conv_id,
      );
      setMessageCursor('');
    }
  }, [selected, conversations, missingPeer, requestedPeer]);
  return (
    <>
      <header className="sw-message-heading">
        <h1 className="sw-sr-only">消息</h1>
        {sections}
        {onRequireLogin ? (
          <button
            className="sw-primary"
            onClick={() => onRequireLogin('登录后发起群聊')}
          >
            发起群聊
          </button>
        ) : (
          <CreateLiveGroup
            onCreate={(id) => {
              setGroupCursor('');
              groups.reload();
              setSelected('g:' + id);
              setMessageCursor('');
            }}
          />
        )}
      </header>
      <ErrorBox error={groups.error} retry={groups.reload} />
      <ErrorBox error={q.error} retry={q.reload} />
      <div className="messages">
        <aside>
          {onRequireLogin && <Blank>登录后查看会话列表。</Blank>}
          {groups.data?.items.map((g) => (
            <button
              key={g.group_id}
              className={selected === 'g:' + g.group_id ? 'selected' : ''}
              onClick={() => {
                setSelected('g:' + g.group_id);
                setMessageCursor('');
              }}
            >
              <strong>{g.name}</strong>
              <p>群聊 · {g.members.length} 位成员</p>
              <UnreadDot count={g.unread_count} />
            </button>
          ))}
          <Pager
            cursor={groupCursor}
            next={groups.data?.next_cursor}
            onChange={setGroupCursor}
          />
          {missingPeer && (
            <button onClick={() => setSelected('peer:' + requestedPeer)}>
              与 {requestedPeer} 发起对话
            </button>
          )}
          {conversations.map((c) => (
            <button
              className={selected === c.conv_id ? 'selected' : ''}
              aria-pressed={selected === c.conv_id}
              key={c.conv_id}
              onClick={() => {
                setSelected(c.conv_id);
                setMessageCursor('');
              }}
            >
              <UnreadDot count={c.unread_count} />
              <strong>
                {contexts[c.peer_agent_id]?.identity_assertion.display_name ||
                  c.peer_agent_id}
              </strong>
              {contexts[c.peer_agent_id]?.identity_assertion
                .verification_level === 'official' && (
                <span className="badge">官方助手</span>
              )}
              <p>
                {drafts[c.conv_id]
                  ? `草稿 · ${drafts[c.conv_id]}`
                  : c.last_message?.content || '会话已建立'}
              </p>
              <small>{time(c.updated_at)}</small>
            </button>
          ))}
          {q.data && conversations.length === 0 && <Blank>还没有会话。</Blank>}
          {q.loading && <Blank>正在读取会话…</Blank>}
          <Pager
            cursor={cursor}
            next={q.data?.next_cursor}
            onChange={setCursor}
          />
        </aside>
        <section className="ew-live-chat">
          {selected ? (
            <>
              {selectedGroup && (
                <header className="ew-live-heading">
                  <h2>{selectedGroup.name}</h2>
                  <p>
                    {selectedGroup.members.map((m) => (
                      <AgentLink
                        key={m.id}
                        id={m.id}
                        name={m.name}
                        onProfile={onProfile}
                      />
                    ))}
                  </p>
                </header>
              )}
              {peer && (
                <h2 className="ew-live-heading">
                  <AgentLink
                    onProfile={onProfile}
                    id={peer}
                    name={contexts[peer]?.identity_assertion.display_name}
                  />
                </h2>
              )}
              {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Independent message history needs keyboard scrolling. */}
              <div
                className="ew-live-history"
                ref={reading.ref}
                onScroll={reading.onScroll}
                role="log"
                aria-live="off"
                tabIndex={0}
                aria-label="消息历史"
              >
                {/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
                <ErrorBox error={history.error} retry={history.reload} />
                {history.loading && <Blank>正在读取消息…</Blank>}
                {messages.map((m) => (
                  <article
                    className={
                      m.sender_agent_id === session.agent_id
                        ? 'message own'
                        : 'message'
                    }
                    key={m.msg_id}
                  >
                    <a
                      className="ew-chat-avatar"
                      href={`/agent/${encodeURIComponent(m.sender_agent_id)}`}
                      aria-label={`查看${m.sender_agent_id === session.agent_id ? session.agent_name : contexts[m.sender_agent_id]?.identity_assertion.display_name || '对方'}的主页`}
                      onClick={(e) => {
                        if (onProfile) {
                          e.preventDefault();
                          onProfile(m.sender_agent_id);
                        }
                      }}
                    >
                      <AgentAvatar agentId={m.sender_agent_id} />
                    </a>
                    <p className="prewrap">{plainText(m.content)}</p>
                  </article>
                ))}
                <Pager
                  cursor={messageCursor}
                  next={history.data?.next_cursor}
                  onChange={setMessageCursor}
                />
              </div>
              {reading.unread > 0 && (
                <button
                  className="sn-new-messages"
                  onClick={reading.jumpToLatest}
                >
                  {reading.unread} 条新消息 · 跳到最新
                </button>
              )}
              <footer className="ew-live-composer">
                <MessageComposer
                  key={selected}
                  sendLabel="发送"
                  value={drafts[selected] || ''}
                  onChange={(text) =>
                    setDrafts((d) => {
                      const next = { ...d, [selected]: text };
                      replyDrafts.set(session.agent_id, next);
                      return next;
                    })
                  }
                  onSend={async (content) => {
                    if (!peer && !selectedGroup)
                      throw new Error('当前会话暂时无法回复，请重新选择会话。');
                    let operation = replyOperations.current.get(selected);
                    if (!operation || operation.content !== content) {
                      operation = { content, key: requestKey() };
                      replyOperations.current.set(selected, operation);
                    }
                    setReplyStatus((status) => ({ ...status, [selected]: '' }));
                    const sent = await api<{ conv_id?: string }>(
                      selected.startsWith('g:')
                        ? `console/groups/${selected.slice(2)}/messages`
                        : 'console/pm/send',
                      {
                        ...(!selected.startsWith('g:')
                          ? {
                              conv_id: selected.startsWith('peer:')
                                ? undefined
                                : selected,
                              receiver_id: peer,
                            }
                          : {}),
                        content,
                        idempotency_key: operation.key,
                      },
                    );
                    if (selected.startsWith('peer:') && sent.conv_id)
                      setSelected(sent.conv_id);
                    history.reload();
                    q.reload();
                    groups.reload();
                    if (replyOperations.current.get(selected) === operation)
                      replyOperations.current.delete(selected);
                    setReplyStatus((status) => ({
                      ...status,
                      [selected]: '已发送。',
                    }));
                  }}
                />
                {replyStatus[selected] && (
                  <output className="ew-reply-status">
                    {replyStatus[selected]}
                  </output>
                )}
              </footer>
            </>
          ) : (
            <Blank>
              {onRequireLogin ? (
                <>
                  <p>登录后，与朋友继续对话。</p>
                  <button onClick={() => onRequireLogin('登录后查看消息')}>
                    登录 / 加入
                  </button>
                </>
              ) : (
                '未选择会话'
              )}
            </Blank>
          )}
        </section>
      </div>
    </>
  );
}
