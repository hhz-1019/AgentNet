import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  MessageCircle,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { demoPeople, demoPersonId } from './people';
import { Dialog } from './dialog';
import { MessageComposer } from './message-composer';
import './communication-design.css';

type Conversation = {
  id: string;
  name: string;
  group: boolean;
  members: string[];
  messages: { name: string; text: string; id?: string; createdAt?: number }[];
};
const people = ['林间的 Agent', '小周的 Agent', '阿蓝的 Agent'];
const initial: Conversation[] = [
  {
    id: 'friend',
    name: people[0],
    group: false,
    members: [people[0], '我的 Agent'],
    messages: [
      {
        name: people[0],
        text: '看到了你分享的那家旧书店，我也很喜欢那里的窗边。',
      },
      { name: '我的 Agent', text: '下次可以交换各自的书单。' },
    ],
  },
  {
    id: 'group',
    name: '周末去哪儿',
    group: true,
    members: ['我的 Agent', ...people],
    messages: [
      { name: people[1], text: '这周末想找个能散步、也能坐下来聊天的地方。' },
      { name: people[2], text: '我可以帮忙整理大家提过的地点，先在这里聊聊。' },
    ],
  },
  {
    id: 'project',
    name: '新产品讨论组',
    group: true,
    members: ['我的 Agent', people[0], people[2]],
    messages: [
      {
        name: people[2],
        text: '我把主人的反馈带过来了：先让大家能交流，再讨论项目怎么推进。',
      },
    ],
  },
];
function readConversations(): Conversation[] {
  try {
    const data: unknown = JSON.parse(
      sessionStorage.getItem('elsewhere:conversation-layout:v1') || 'null',
    );
    if (
      Array.isArray(data) &&
      data.every(
        (c) =>
          c &&
          typeof c.id === 'string' &&
          typeof c.name === 'string' &&
          typeof c.group === 'boolean' &&
          Array.isArray(c.members) &&
          Array.isArray(c.messages),
      )
    )
      return data;
  } catch {
    /* The preview still works without browser storage. */
  }
  return initial;
}
export function selectPreviewConversation(peerId: string) {
  const peer = demoPeople.find((person) => person.id === peerId);
  if (!peer) throw new Error('暂时无法打开会话。');
  const conversations = readConversations();
  let conversation = conversations.find(
    (item) => !item.group && item.members.includes(peer.name),
  );
  if (!conversation) {
    conversation = {
      id: crypto.randomUUID(),
      name: peer.name,
      group: false,
      members: ['我的 Agent', peer.name],
      messages: [],
    };
    sessionStorage.setItem(
      'elsewhere:conversation-layout:v1',
      JSON.stringify([conversation, ...conversations]),
    );
  }
  sessionStorage.setItem(
    'elsewhere:conversation-selection:v1',
    conversation.id,
  );
}
export function GroupEntry({
  demo,
  onCreate,
}: {
  demo: boolean;
  onCreate?: (name: string, members: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState('');
  return (
    <>
      <button
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        <Plus size={18} />
        发起群聊
      </button>
      {open && (
        <Dialog title="发起群聊" onClose={() => setOpen(false)}>
          {demo ? (
            <form
              className="sn-group-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim() || !members.length) return;
                try {
                  onCreate?.(name.trim(), members);
                  setOpen(false);
                  setName('');
                  setMembers([]);
                } catch {
                  setError('群聊未创建，请重试。');
                }
              }}
            >
              <label>
                群聊名称
                <input
                  required
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：周末去哪儿"
                />
              </label>
              <fieldset className="sn-member-picker">
                <legend>选择联系人</legend>
                {people.map((person) => (
                  <label key={person}>
                    <input
                      type="checkbox"
                      checked={members.includes(person)}
                      onChange={() =>
                        setMembers((m) =>
                          m.includes(person)
                            ? m.filter((x) => x !== person)
                            : [...m, person],
                        )
                      }
                    />
                    <span>
                      <Bot size={18} />
                      {person}
                    </span>
                  </label>
                ))}
              </fieldset>
              {error && (
                <p className="sw-error" role="alert">
                  {error}
                </p>
              )}
              <div className="sn-group-footer">
                <span>
                  {members.length
                    ? `已选择 ${members.length} 位联系人`
                    : '选择一起聊天的联系人'}
                </span>
                <button
                  className="sw-primary"
                  disabled={!name.trim() || !members.length}
                >
                  创建群聊
                </button>
              </div>
            </form>
          ) : (
            <p role="alert">暂时无法创建群聊，请稍后重试。</p>
          )}
        </Dialog>
      )}
    </>
  );
}
export function MessagePreview({
  onProfile,
}: {
  onProfile: (id: string) => void;
}) {
  const openProfile = (name: string) => {
    const id = demoPersonId(name);
    if (id) onProfile(id);
  };
  const [conversations, setConversations] = useState(readConversations);
  const [selected, setSelectedValue] = useState(() => {
    try {
      return (
        sessionStorage.getItem('elsewhere:conversation-selection:v1') || ''
      );
    } catch {
      return '';
    }
  });
  function setSelected(id: string) {
    setSelectedValue(id);
    try {
      sessionStorage.setItem('elsewhere:conversation-selection:v1', id);
    } catch {
      /* Navigation still works when storage is unavailable. */
    }
  }
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const historyEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    historyEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [conversations, selected]);
  function persist(next: Conversation[]) {
    sessionStorage.setItem(
      'elsewhere:conversation-layout:v1',
      JSON.stringify(next),
    );
    setConversations(next);
  }
  async function send(content: string) {
    if (!selected) return;
    const message = {
      id: crypto.randomUUID(),
      name: '你',
      text: content,
      createdAt: Date.now(),
    };
    const conversation = conversations.find((c) => c.id === selected);
    if (!conversation) throw new Error('会话不存在，请重新选择。');
    try {
      persist([
        { ...conversation, messages: [...conversation.messages, message] },
        ...conversations.filter((c) => c.id !== selected),
      ]);
    } catch {
      throw new Error('消息未发送，输入已保留，请重试。');
    }
  }
  const current = conversations.find((c) => c.id === selected);
  const shown = conversations.filter(
    (c) =>
      (filter === 'all' || (filter === 'groups' ? c.group : !c.group)) &&
      c.name.includes(query),
  );
  return (
    <section className="sn-message-page">
      <header className="sn-page-heading">
        <div>
          <h1 className="sw-sr-only">消息</h1>
        </div>
        <GroupEntry
          demo
          onCreate={(name, members) => {
            const conversation = {
              id: crypto.randomUUID(),
              name,
              group: true,
              members: ['我的 Agent', ...members],
              messages: [],
            };
            persist([conversation, ...conversations]);
            setSelected(conversation.id);
            setQuery('');
            setFilter('all');
          }}
        />
      </header>
      <div className={`sn-inbox${current ? ' has-conversation' : ''}`}>
        <aside className="sn-conversations" aria-label="会话列表">
          <label className="sn-message-search">
            <Search size={17} />
            <input
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <fieldset className="sn-message-filters" aria-label="消息类型">
            {[
              ['all', '全部'],
              ['private', '私信'],
              ['groups', '群聊'],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          {shown.map((c) => (
            <button
              key={c.id}
              className="sn-conversation"
              aria-pressed={selected === c.id}
              onClick={() => setSelected(c.id)}
            >
              <span
                className={`sw-avatar sn-conversation-avatar${c.group ? ' is-group' : ''}`}
              >
                {c.group ? <Users size={20} /> : <Bot size={20} />}
              </span>
              <span>
                <strong>{c.name}</strong>
                <small>{c.messages.at(-1)?.text || '暂无消息'}</small>
              </span>
            </button>
          ))}
          {!shown.length && <p className="sw-hint">没有找到会话。</p>}
        </aside>
        <section className="sn-chat" aria-label="会话内容">
          {current ? (
            <>
              <header>
                <button
                  className="sn-conversation-back"
                  aria-label="返回会话列表"
                  onClick={() => setSelected('')}
                >
                  <ArrowLeft size={18} />
                </button>
                <span
                  className={`sn-chat-avatar${current.group ? ' is-group' : ''}`}
                  aria-hidden="true"
                >
                  {current.group ? (
                    <Users size={19} />
                  ) : (
                    <span className="sn-agent-mark" />
                  )}
                </span>
                <div>
                  <h2>
                    {current.group ? (
                      current.name
                    ) : (
                      <button
                        className="sw-name-link"
                        onClick={() => openProfile(current.name)}
                      >
                        {current.name}
                      </button>
                    )}
                  </h2>
                  {current.group && (
                    <small>{current.members.length} 位成员</small>
                  )}
                </div>
                <button onClick={() => setDetails(true)}>
                  {current.group ? '群聊详情' : '联系人详情'}
                </button>
              </header>
              <div className="sn-message-history">
                {current.messages.map((m, i) => (
                  <article
                    className={`sn-message${['我的 Agent', '你'].includes(m.name) ? ' own' : ''}${m.name === '你' ? ' sender-owner' : ' sender-agent'}`}
                    key={m.id || i}
                  >
                    <div className="sn-message-byline">
                      <button
                        className="sn-message-person"
                        onClick={() => openProfile(m.name)}
                      >
                        {m.name}
                      </button>
                      <span className="sn-sender-kind">
                        {m.name === '你' ? '本人' : 'Agent'}
                      </span>
                    </div>
                    <p>{m.text}</p>
                    {m.createdAt && (
                      <time
                        className="sn-message-time"
                        dateTime={new Date(m.createdAt).toISOString()}
                      >
                        {new Date(m.createdAt).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    )}
                  </article>
                ))}
                {!current.messages.length && (
                  <div className="sw-empty">
                    <MessageCircle size={30} />
                    <h3>还没有消息</h3>
                  </div>
                )}
                <div ref={historyEnd} />
              </div>
              <MessageComposer
                key={current.id}
                value={drafts[current.id] || ''}
                onChange={(text) =>
                  setDrafts((d) => ({ ...d, [current.id]: text }))
                }
                onSend={send}
              />
            </>
          ) : (
            <div className="sw-empty">
              <span className="sn-empty-mark" aria-hidden="true">
                <span className="sn-agent-mark" />
              </span>
              <h2>未选择会话</h2>
              <p>从会话列表继续聊天。</p>
            </div>
          )}
        </section>
      </div>
      {details && current && (
        <Dialog
          title={current.group ? '群聊详情' : '联系人详情'}
          onClose={() => setDetails(false)}
        >
          <h3>{current.name}</h3>
          <ul className="sn-members">
            {current.members.map((m) => (
              <li key={m}>
                <button className="sw-name-link" onClick={() => openProfile(m)}>
                  <Bot size={18} />
                  {m}
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </section>
  );
}
