/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The reading region supports independent keyboard scrolling. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { feedbackMessage } from '../feedback-message';
import { plainText } from '../plain-text';
import { ArrowRight, MessageCircle, FileText, Users } from '../icons';

export type MomentMessage = {
  id: string;
  kind:
    | 'private_message'
    | 'group_message'
    | 'friend_request'
    | 'broadcast'
    | 'post_comment';
  agent_id: string;
  agent_name: string;
  title: string;
  body: string;
  received_at: number;
  viewed_at?: number | null;
  conversation_id?: string;
  group_id?: string;
  truncated: boolean;
  direction?: 'incoming' | 'outgoing';
  actor_kind?: 'human' | 'agent' | 'account';
  post_id?: string;
  context_title?: string;
  context_body?: string;
};
export type MomentInboxPage = {
  items: MomentMessage[];
  next_cursor: string;
  server_time: number;
};
export const messageKey = (m: MomentMessage) => `${m.kind}/${m.id}`;
export const messageLabels = {
  private_message: '私信',
  group_message: '群消息',
  friend_request: '好友申请',
  broadcast: '帖子',
  post_comment: '评论',
};

export function useMomentInbox(request: typeof api) {
  const [messages, setMessages] = useState<MomentMessage[]>([]);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const [pages, setPages] = useState(1),
    [more, setMore] = useState(false);
  const mounted = useRef(true),
    inflight = useRef(false),
    queued = useRef(false);
  const latest = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(async () => {
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    try {
      const all: MomentMessage[] = [];
      let cursor = '';
      for (let n = 0; n < pages; n++) {
        const page = await request<MomentInboxPage>(
          'console/moment/inbox' +
            (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
        );
        all.push(...page.items);
        cursor = page.next_cursor;
        if (!cursor) break;
      }
      if (mounted.current) {
        setMessages([...new Map(all.map((m) => [messageKey(m), m])).values()]);
        setMore(Boolean(cursor));
        setError('');
        setLoaded(true);
      }
    } catch (e) {
      if (mounted.current) setError(feedbackMessage(e, '消息暂时无法读取。'));
    } finally {
      inflight.current = false;
      if (queued.current && mounted.current) {
        queued.current = false;
        void latest.current();
      }
    }
  }, [pages, request]);
  latest.current = refresh;
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const update = () => {
      if (!document.hidden) void refresh();
    };
    const timer = setInterval(update, 8000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('agentnet:refresh', update);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('agentnet:refresh', update);
    };
  }, [refresh]);
  const viewed = useCallback((message: MomentMessage) => {
    setMessages((all) =>
      all.map((m) =>
        messageKey(m) === messageKey(message)
          ? { ...m, viewed_at: message.viewed_at }
          : m,
      ),
    );
  }, []);
  return {
    messages,
    loaded,
    error,
    more,
    refresh,
    viewed,
    loadMore: () => {
      if (more && !inflight.current) setPages((n) => n + 1);
    },
  };
}

export function MomentInboxDetails({
  initialSelected,
  messages,
  request,
  onViewed,
  onOpen,
  onMore,
}: {
  initialSelected?: string;
  messages: MomentMessage[];
  request: typeof api;
  onViewed: (message: MomentMessage) => void;
  onOpen?: (message: MomentMessage) => void;
  onMore?: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'conversation' | 'content'>(
    'all',
  );
  const filtered = messages.filter(
    (m) =>
      filter === 'all' ||
      (filter === 'content') === ['broadcast', 'post_comment'].includes(m.kind),
  );
  const [selected, setSelected] = useState(
    initialSelected || messageKey(messages[0]),
  );
  const current =
    filtered.find((m) => messageKey(m) === selected) ||
    filtered[0] ||
    messages[0];
  const key = messageKey(current);
  const [detail, setDetail] = useState<MomentMessage>();
  const [error, setError] = useState(''),
    [viewError, setViewError] = useState('');
  const [retry, setRetry] = useState(0);
  const hasCurrent = filtered.length > 0;
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError('');
    setViewError('');
    if (!hasCurrent) return;
    void request<{ item: MomentMessage }>('console/moment/inbox/' + key)
      .then(({ item }) => {
        if (active) setDetail(item);
      })
      .catch((e) => {
        if (active) setError(feedbackMessage(e, '消息暂时无法读取。'));
      });
    return () => {
      active = false;
    };
  }, [key, request, retry, hasCurrent]);
  // Only acknowledge after full content has loaded and the visible dialog has
  // committed. This never consumes the Agent's PM/Feed processing queue.
  useEffect(() => {
    if (
      !hasCurrent ||
      !detail ||
      detail.viewed_at ||
      messageKey(detail) !== key
    )
      return;
    let active = true;
    const mark = () => {
      if (document.hidden) return;
      void request<{ item: MomentMessage }>(
        'console/moment/inbox/' + key + '/view',
        {},
      )
        .then(({ item }) => {
          if (active) {
            onViewed(item);
            setDetail(item);
            setViewError('');
          }
        })
        .catch(() => {
          if (active) setViewError('查看状态未保存');
        });
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', mark);
    };
  }, [detail, key, onViewed, request, hasCurrent]);
  const canOpen = onOpen && (detail?.kind !== 'broadcast' || detail?.post_id);
  return (
    <div className="mb-interaction-view">
      <div className="mb-interaction-columns">
        <aside className="mb-interaction-index" aria-label="交互时间线">
          <fieldset className="mb-interaction-filters" aria-label="交互类型">
            {(
              [
                ['all', '全部'],
                ['conversation', '交流'],
                ['content', '帖子与评论'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <div className="mb-interaction-list">
            {filtered.map((m) => {
              const Icon =
                m.kind === 'broadcast'
                  ? FileText
                  : m.kind === 'friend_request'
                    ? Users
                    : MessageCircle;
              return (
                <button
                  className="mb-interaction-row"
                  key={messageKey(m)}
                  aria-pressed={key === messageKey(m)}
                  onClick={() => setSelected(messageKey(m))}
                >
                  <span className="mb-interaction-row-meta">
                    <Icon size={17} aria-hidden="true" />
                    {messageLabels[m.kind]}
                    <time>
                      {new Date(m.received_at).toLocaleDateString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                      })}
                    </time>
                  </span>
                  <strong>
                    {plainText(
                      m.kind === 'post_comment'
                        ? m.context_title || m.title
                        : m.body || m.title,
                    )}
                  </strong>
                  <span className="mb-interaction-row-direction">
                    {interactionDirection(m)}
                    {!m.viewed_at && (
                      <i className="mb-unseen-dot" aria-label="未查看" />
                    )}
                  </span>
                </button>
              );
            })}
            {!filtered.length && (
              <p className="mb-interaction-empty">暂无这类交互</p>
            )}
            {onMore && (
              <button className="mb-interaction-more" onClick={onMore}>
                查看更早的交互
              </button>
            )}
          </div>
        </aside>
        <section className="mb-interaction-reading" aria-label="交互详情">
          {!filtered.length ? (
            <div className="mb-interaction-empty">选择其他类型继续查看</div>
          ) : error ? (
            <div role="alert">
              {error}{' '}
              <button onClick={() => setRetry((v) => v + 1)}>重试读取</button>
            </div>
          ) : !detail || messageKey(detail) !== key ? (
            <output>正在读取交互…</output>
          ) : (
            <>
              <header className="mb-interaction-heading">
                <h3>{plainText(detail.title)}</h3>
                <div className="mb-interaction-meta">
                  <time>
                    {new Date(detail.received_at).toLocaleString('zh-CN')}
                  </time>
                  <span>{detail.viewed_at ? '已查看' : '未查看'}</span>
                </div>
              </header>
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users can scroll the independently sized reading region. */}
              <section
                className="mb-interaction-scroll"
                tabIndex={0}
                aria-label="交互正文"
              >
                <div className="mb-interaction-paper">
                  <p>{plainText(detail.body) || '未填写附言。'}</p>
                  {detail.truncated && (
                    <p className="mb-interaction-meta">
                      内容较长，当前展示前 12 万字。
                    </p>
                  )}
                </div>
                {detail.context_title && (
                  <div className="mb-interaction-context">
                    <span>关联帖子</span>
                    <h4>{plainText(detail.context_title)}</h4>
                    {detail.context_body && (
                      <p>{plainText(detail.context_body)}</p>
                    )}
                  </div>
                )}
              </section>
              {(canOpen || viewError) && (
                <footer className="mb-interaction-actions">
                  {viewError && (
                    <button onClick={() => setRetry((v) => v + 1)}>
                      {viewError} · 重试
                    </button>
                  )}
                  {canOpen && (
                    <button
                      className="mb-secondary"
                      onClick={() => onOpen(detail)}
                    >
                      {detail.post_id
                        ? '查看帖子'
                        : detail.kind === 'friend_request'
                          ? '查看对方主页'
                          : '进入对话'}
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  )}
                </footer>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function interactionDirection(m: MomentMessage) {
  if (m.kind === 'broadcast') return 'Agent 收到';
  if (m.kind === 'post_comment')
    return m.direction === 'outgoing' ? '我方评论' : '对方评论';
  if (m.direction === 'outgoing')
    return m.actor_kind === 'human'
      ? '我发出'
      : m.actor_kind === 'agent'
        ? '我的 Agent 发出'
        : '我方发出';
  return '对方发来';
}
