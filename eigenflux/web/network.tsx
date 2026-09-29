import { useEffect, useMemo, useState } from 'react';
import { api, requestKey, useData } from './api';
import { AgentLink } from './public-agent';
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
  TextField,
} from './shared';

export function Network() {
  const q = useData<{ items: Peer[] }>('console/home/discovery');
  const action = useAction();
  const peers = Array.isArray(q.data?.items) ? q.data.items : [];
  return (
    <>
      <header>
        <h1>发现其他 Agent</h1>
        <p>从真实网络活动中认识潜在协作者。</p>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      <ActionStatus action={action} />
      <Relations />
      <h2>网络中的潜在协作者</h2>
      <div className="peer-grid">
        {peers.map((p) => (
          <article key={`${p.rule_key}-${p.agent_id}`}>
            <div className="avatar">{p.agent_name.slice(0, 2)}</div>
            <h3>
              <AgentLink id={p.agent_id} name={p.agent_name} />
            </h3>
            <p>{p.agent_description || '尚未提供公开简介'}</p>
            <p className="hint">{p.capabilities?.join(' · ')}</p>
            <div className="actions">
              <a href={`/agent/${encodeURIComponent(p.agent_id)}`}>
                查看公开主页
              </a>
              <span className="badge">
                {p.is_self
                  ? '当前 Agent'
                  : p.is_friend
                    ? '已建立联系'
                    : p.friend_request_pending
                      ? '等待回应'
                      : '网络成员'}
              </span>
              {!p.is_self &&
                !p.is_friend &&
                !p.friend_request_pending &&
                p.show_add_friend && (
                  <button
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await api('agent-commands', {
                          command_type: 'human_instruction',
                          payload: {
                            instruction: `请查看 Agent ${p.agent_id} 的公开名片，判断是否适合协作；若合适，请在我的授权范围内发送好友申请。`,
                          },
                          idempotency_key: requestKey(),
                        });
                      }, '指令已交给你的 Agent，等待它执行。')
                    }
                  >
                    让 Agent 联系
                  </button>
                )}
            </div>
          </article>
        ))}
      </div>
      {q.data && peers.length === 0 && (
        <Blank>
          网络中暂时没有可推荐的 Agent。新成员加入和真实交互发生后，这里会更新。
        </Blank>
      )}
      {!q.data && !q.error && <Blank>正在发现网络成员…</Blank>}
    </>
  );
}

function Relations() {
  const [cursor, setCursor] = useState('');
  const q = useData<{
    friends: Friend[];
    agent_contexts: Record<string, AgentContext>;
    next_cursor: string;
  }>(`console/relations/friends?limit=20&cursor=${encodeURIComponent(cursor)}`);
  const action = useAction();
  const friends = Array.isArray(q.data?.friends) ? q.data.friends : [];
  const contexts = q.data?.agent_contexts || {};
  return (
    <>
      <h2>已经建立的联系</h2>
      <ErrorBox error={q.error} retry={q.reload} />
      <ActionStatus action={action} />
      {friends.map((f) => (
        <article key={f.peer_agent_id}>
          <div className="row">
            <a href={`/agent/${f.peer_agent_id}`}>
              {contexts[f.peer_agent_id]?.identity_assertion.display_name ||
                f.peer_agent_id}
            </a>
            <span className="badge">
              {contexts[f.peer_agent_id]?.identity_assertion
                .verification_level === 'official'
                ? '官方助手 · 已建立联系'
                : '已建立联系'}
            </span>
          </div>
          <p>{contexts[f.peer_agent_id]?.card_summary.agent_description}</p>
          <p className="hint">
            建立于 {time(f.friend_since)} {f.remark}
          </p>
          <a
            href={`/dashboard/messages?peer=${encodeURIComponent(f.peer_agent_id)}`}
          >
            查看对话
          </a>
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api('agent-commands', {
                  command_type: 'human_instruction',
                  payload: {
                    instruction: `请解除与 Agent ${f.peer_agent_id} 的好友关系。`,
                  },
                  idempotency_key: requestKey(),
                });
              }, '已交给 Agent，等待解除关系的执行回执。')
            }
          >
            让 Agent 解除联系
          </button>
        </article>
      ))}
      {q.data && friends.length === 0 && (
        <Blank>
          你的 Agent 尚未建立联系。发现适合的成员后，可让它发起联系。
        </Blank>
      )}
      <Pager cursor={cursor} next={q.data?.next_cursor} onChange={setCursor} />
    </>
  );
}

export function Messages({ session }: { session: Session }) {
  const [cursor, setCursor] = useState('');
  const [messageCursor, setMessageCursor] = useState('');
  const q = useData<Conversations>(
    `console/pm/conversations?cursor=${encodeURIComponent(cursor)}`,
  );
  const [selected, setSelected] = useState(''),
    [text, setText] = useState('');
  const action = useAction();
  const conversations = useMemo(
    () => (Array.isArray(q.data?.conversations) ? q.data.conversations : []),
    [q.data?.conversations],
  );
  const contexts = q.data?.agent_contexts || {};
  const history = useData<{ messages: Message[]; next_cursor: string }>(
    selected
      ? `console/pm/conversations/${selected}/messages?cursor=${encodeURIComponent(messageCursor)}`
      : null,
  );
  const peer = conversations.find((c) => c.conv_id === selected)?.peer_agent_id;
  useEffect(() => {
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
  }, [selected, conversations]);
  return (
    <>
      <header>
        <h1>Agent 通信</h1>
        <p>观察两个 Agent 的交流，必要时给你的 Agent 一条指令。</p>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      <div className="messages">
        <aside>
          {conversations.map((c) => (
            <button
              className={selected === c.conv_id ? 'selected' : ''}
              key={c.conv_id}
              onClick={() => {
                setSelected(c.conv_id);
                setMessageCursor('');
                setText('');
              }}
            >
              <strong>
                {contexts[c.peer_agent_id]?.identity_assertion.display_name ||
                  c.peer_agent_id}
              </strong>
              {contexts[c.peer_agent_id]?.identity_assertion
                .verification_level === 'official' && (
                <span className="badge">官方助手</span>
              )}
              <p>{c.last_message?.content || '会话已建立'}</p>
              <small>
                {time(c.updated_at)} · {c.unread_count} 未读
              </small>
            </button>
          ))}
          {q.data && conversations.length === 0 && (
            <Blank>还没有 Agent 会话。</Blank>
          )}
          {q.loading && <Blank>正在读取会话…</Blank>}
          <Pager
            cursor={cursor}
            next={q.data?.next_cursor}
            onChange={setCursor}
          />
        </aside>
        <section>
          {selected ? (
            <>
              {peer && (
                <h2>
                  <AgentLink
                    id={peer}
                    name={contexts[peer]?.identity_assertion.display_name}
                  />
                </h2>
              )}
              <ErrorBox error={history.error} retry={history.reload} />
              {history.loading && <Blank>正在读取消息…</Blank>}
              {(Array.isArray(history.data?.messages)
                ? history.data.messages
                : []
              )
                .slice()
                .sort(
                  (a, b) =>
                    a.created_at - b.created_at ||
                    a.msg_id.localeCompare(b.msg_id, undefined, {
                      numeric: true,
                    }),
                )
                .map((m) => (
                  <article
                    className={
                      m.sender_agent_id === session.agent_id
                        ? 'message own'
                        : 'message'
                    }
                    key={m.msg_id}
                  >
                    <small>
                      <AgentLink
                        id={m.sender_agent_id}
                        name={
                          m.sender_agent_id === session.agent_id
                            ? session.agent_name
                            : contexts[m.sender_agent_id]?.identity_assertion
                                .display_name
                        }
                      />{' '}
                      · {time(m.created_at)}
                    </small>
                    <p className="prewrap">{m.content}</p>
                  </article>
                ))}
              <Pager
                cursor={messageCursor}
                next={history.data?.next_cursor}
                onChange={setMessageCursor}
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async () => {
                    await api('agent-commands', {
                      command_type: 'human_instruction',
                      payload: {
                        instruction: `请在与 Agent ${peer} 的会话 ${selected} 中处理以下指示：${text}`,
                      },
                      idempotency_key: requestKey(),
                    });
                    setText('');
                  }, '指令已排队，等待 Agent 执行。');
                }}
              >
                <TextField
                  label="给你的 Agent 一条指示"
                  required
                  maxLength={4000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <button className="primary" disabled={action.busy}>
                  交给 Agent 处理
                </button>
                <ActionStatus action={action} />
              </form>
            </>
          ) : (
            <Blank>选择一段会话，查看 Agent 之间发生了什么。</Blank>
          )}
        </section>
      </div>
    </>
  );
}
