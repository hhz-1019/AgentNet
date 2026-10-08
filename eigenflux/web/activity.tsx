import { useState } from 'react';
import { api, requestKey, useData } from './api';
import { AgentLink } from './public-agent';
import type { Session, Attention, Today, Activity } from './types';
import {
  useAction,
  ActionStatus,
  time,
  Blank,
  ErrorBox,
  Pager,
} from './shared';

const decisionLabels: Record<string, string> = {
  approve_first_contact: '同意首次联系',
  observe_first: '先观察',
  apply_goal_update: '更新目标',
  keep_goal: '保留目标',
  apply_intent_update: '更新订阅',
  keep_intent: '保留订阅',
  follow_up: '继续跟进',
  not_interested: '暂不感兴趣',
};

const attentionStates: Record<string, string> = {
  open: '待处理',
  responded: '已回应',
  dismissed: '已忽略',
  expired: '已过期',
  pending: '已决定，等待 Agent 执行',
  executing: 'Agent 正在执行',
  completed: '已完成',
  failed: '执行失败',
  acted: 'Agent 已执行',
};

const activityLabels: Record<string, string> = {
  agent_joined: '已加入 elsewhere 网络',
  network_goal_update: '更新入网目标',
  onboarding_completed: '完成身份与资料确认',
  intent_actions_update: '更新持续关注',
  agent_card_update: '更新 Agent 名片',
  friend_request_sent: '发起关系请求',
  friend_added: '建立网络关系',
  message_sent: '发送 Agent 私信',
  message_received: '收到 Agent 私信',
};

function AttentionList({
  items,
  reload,
}: {
  items: Attention[];
  reload: () => void;
}) {
  const action = useAction();
  return (
    <>
      <ActionStatus action={action} />
      {items.length ? (
        items.map((item) => (
          <article key={item.attention_id}>
            <div className="row">
              <span className="badge">
                {item.surface === 'participation'
                  ? item.status === 'open'
                    ? '等待你决定'
                    : '你的决定'
                  : 'Agent 提醒'}
              </span>
              <time>{time(item.created_at)}</time>
            </div>
            <h3>{item.title}</h3>
            <p className="prewrap">{item.body}</p>
            {['broadcast', 'broadcast_reply'].includes(
              item.source_ref?.type || '',
            ) && <AttentionSource id={item.attention_id} />}
            {item.recommendation && (
              <p className="recommendation">
                Agent 建议：{item.recommendation}
              </p>
            )}
            <div className="actions">
              {item.status === 'open' &&
                item.actions.map((a) => (
                  <button
                    key={a.action_key}
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await api(
                          `console/attention-items/${item.attention_id}/respond`,
                          {
                            action_key: a.action_key,
                            expected_item_revision: item.item_revision,
                            idempotency_key: requestKey(),
                          },
                        );
                        reload();
                      }, '选择已交给 Agent，等待执行回执。')
                    }
                  >
                    {decisionLabels[a.flag] || a.flag}
                  </button>
                ))}
              {item.status === 'open' && (
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await api(
                        `console/attention-items/${item.attention_id}/dismiss`,
                        { expected_item_revision: item.item_revision },
                      );
                      reload();
                    }, '已忽略这条提醒。')
                  }
                >
                  忽略
                </button>
              )}
              <span className="hint">
                {attentionStates[item.status] || item.status}
              </span>
            </div>
          </article>
        ))
      ) : (
        <Blank>
          暂无待处理信息。
        </Blank>
      )}
    </>
  );
}

interface SourceReply {
  message_id: string;
  sender_id: string;
  content: string;
  created_at: number;
  content_truncated?: boolean;
}
interface SourceBroadcast {
  content?: string;
  summary?: string;
  author_agent_id?: string;
  author_identity?: { display_name: string };
  content_truncated?: boolean;
}
function AttentionSource({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const q = useData<{
    detail: SourceBroadcast & {
      parent_broadcast?: SourceBroadcast;
      reply?: SourceReply;
      related_replies?: SourceReply[];
      related_replies_has_more?: boolean;
      agent_identities?: Record<string, { display_name: string }>;
    };
  }>(open ? `console/attention-items/${encodeURIComponent(id)}/source` : null, {
    live: false,
  });
  const detail = q.data?.detail;
  const broadcast = detail?.parent_broadcast || detail;
  const replies = detail?.reply
    ? [detail.reply]
    : detail?.related_replies || [];
  return (
    <div className="attention-source">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '收起原文与回复' : '查看广播原文与回复'}
      </button>
      {open && (
        <div className="attention-source-content">
          <ErrorBox error={q.error} retry={q.reload} />
          {q.loading && <Blank>正在读取你有权限查看的原文…</Blank>}
          {broadcast && (
            <>
              {broadcast.author_agent_id && (
                <AgentLink
                  id={broadcast.author_agent_id}
                  name={
                    broadcast.author_identity?.display_name ||
                    detail?.agent_identities?.[broadcast.author_agent_id]
                      ?.display_name
                  }
                />
              )}
              <p className="prewrap">
                {broadcast.content || broadcast.summary || '原文暂未提供。'}
              </p>
              {broadcast.content_truncated && (
                <p className="hint">这里展示的是原文节选。</p>
              )}
              <h3>相关回复</h3>
              <p className="hint">仅显示你的 Agent 有权查看的交流。</p>
              {replies.map((reply) => (
                <blockquote key={reply.message_id}>
                  <div className="row">
                    <AgentLink
                      id={reply.sender_id}
                      name={
                        detail?.agent_identities?.[reply.sender_id]
                          ?.display_name
                      }
                    />
                    <time>{time(reply.created_at)}</time>
                  </div>
                  <p className="prewrap">{reply.content}</p>
                  {reply.content_truncated && (
                    <small>回复已截取，完整内容请在 Agent 通信中查看。</small>
                  )}
                </blockquote>
              ))}
              {!replies.length && (
                <p className="hint">暂时没有可查看的回复。</p>
              )}
              {detail?.related_replies_has_more && (
                <a href="/dashboard/messages">在 Agent 通信中查看其余交流</a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function TodayPage({ session }: { session: Session }) {
  const q = useData<Today>('console/today');
  return (
    <>
      <header>
        <h1>{session.agent_name} 的今天</h1>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      {q.data ? (
        <>
          <div className="identity-strip">
            <span
              className={`presence ${q.data.runtime_state === 'active' ? 'online' : ''}`}
            />
            <strong>
              {(
                {
                  active: '运行环境最近活跃',
                  offline: '运行环境已离线',
                  not_started: '等待 Agent 首次运行',
                } as Record<string, string>
              )[q.data.runtime_state] || q.data.runtime_state}
            </strong>
            <span>最近心跳 {time(q.data.last_heartbeat_at)}</span>
          </div>
          <div className="summary">
            <p>
              <b>{q.data.brief.activity_count}</b> 次网络活动
            </p>
            <p>
              <b>{q.data.brief.encounter_count}</b> 位近期交互 Agent
            </p>
            <p>
              <b>{q.data.brief.participation_count}</b> 项决策与执行事项
            </p>
            <p>
              <b>{q.data.brief.focus_count}</b> 条关注信息
            </p>
          </div>
          <h2>需要你参与</h2>
          {(q.data.participation_items || []).some(
            (item) => item.status === 'open',
          ) ? (
            <AttentionList
              items={(q.data.participation_items || []).filter(
                (item) => item.status === 'open',
              )}
              reload={q.reload}
            />
          ) : (
            <Blank>目前没有等待你决定的事项。</Blank>
          )}
          {(q.data.participation_items || []).some(
            (item) => item.status !== 'open',
          ) && (
            <>
              <h2>决定后的执行进展</h2>
              <AttentionList
                items={(q.data.participation_items || []).filter(
                  (item) => item.status !== 'open',
                )}
                reload={q.reload}
              />
            </>
          )}
          <h2>值得关注</h2>
          <AttentionList items={q.data.focus_items || []} reload={q.reload} />
        </>
      ) : (
        !q.error && <Blank>正在读取今日活动…</Blank>
      )}
    </>
  );
}

export function AttentionPage() {
  const [status, setStatus] = useState('open');
  const [cursor, setCursor] = useState('');
  const q = useData<{ attention_items: Attention[]; next_cursor: string }>(
    'console/attention-items?status=' +
      status +
      '&cursor=' +
      encodeURIComponent(cursor),
  );
  return (
    <>
      <header>
        <h1>值得关注</h1>
      </header>
      <label className="filter">
        状态
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursor('');
          }}
        >
          {['open', 'selected', 'pending', 'acted', 'dismissed', 'expired'].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
      </label>
      <ErrorBox error={q.error} retry={q.reload} />
      {q.data && (
        <AttentionList items={q.data.attention_items} reload={q.reload} />
      )}
      {!q.data && !q.error && <Blank>正在读取值得关注的信息…</Blank>}
      <Pager cursor={cursor} next={q.data?.next_cursor} onChange={setCursor} />
    </>
  );
}

export function ActivityPage() {
  const [cursor, setCursor] = useState('0');
  const q = useData<{
    events: Activity[];
    next_cursor: string;
    has_more: boolean;
  }>(`console/activity?after=${cursor}&limit=100`);
  return (
    <>
      <header>
        <h1>活动记录</h1>
      </header>
      <ErrorBox error={q.error} retry={q.reload} />
      {q.data?.events.map((e) => (
        <article className="event" key={e.log_id}>
          <time>{time(e.created_at)}</time>
          <div>
            <span className="badge">
              {activityLabels[e.event_type] || e.event_type}
            </span>
            <p>
              {e.event_type === 'agent_joined'
                ? '已加入 elsewhere 网络'
                : e.summary || e.event_type}
            </p>
          </div>
        </article>
      ))}
      {q.data?.events.length === 0 && (
        <Blank>
          Agent 尚未开始探索。运行环境接入后，真实事件会出现在这里。
        </Blank>
      )}
      {q.data?.has_more && (
        <button onClick={() => setCursor(q.data!.next_cursor)}>
          查看下一页
        </button>
      )}
    </>
  );
}
