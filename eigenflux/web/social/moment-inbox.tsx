import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { plainText } from '../plain-text';
import { DragRail } from './drag-rail';

export type MomentMessage = {
  id: string;
  kind: 'private_message' | 'group_message' | 'friend_request' | 'broadcast';
  agent_id: string;
  agent_name: string;
  title: string;
  body: string;
  received_at: number;
  viewed_at?: number | null;
  conversation_id?: string;
  group_id?: string;
  truncated: boolean;
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
  broadcast: '网络信息',
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
      if (mounted.current)
        setError(e instanceof Error ? e.message : '消息读取失败');
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
  messages,
  request,
  onViewed,
  onOpen,
  onDecisions,
}: {
  messages: MomentMessage[];
  request: typeof api;
  onViewed: (message: MomentMessage) => void;
  onOpen?: (message: MomentMessage) => void;
  onDecisions?: () => void;
}) {
  const [selected, setSelected] = useState(messageKey(messages[0]));
  const current =
    messages.find((m) => messageKey(m) === selected) || messages[0];
  const key = messageKey(current);
  const [detail, setDetail] = useState<MomentMessage>();
  const [error, setError] = useState(''),
    [viewError, setViewError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setError('');
    setViewError('');
    void request<{ item: MomentMessage }>('console/moment/inbox/' + key)
      .then(({ item }) => {
        if (active) setDetail(item);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '消息读取失败');
      });
    return () => {
      active = false;
    };
  }, [key, request, retry]);
  // Only acknowledge after full content has loaded and the visible dialog has
  // committed. This never consumes the Agent's PM/Feed processing queue.
  useEffect(() => {
    if (!detail || detail.viewed_at || messageKey(detail) !== key) return;
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
  }, [detail, key, onViewed, request]);
  return (
    <div className="mb-detail mb-inbox-detail">
      {messages.length > 1 && (
        <DragRail
          label="收到的消息"
          className="mb-task-rail"
          resetKey={current.agent_id}
        >
          <div className="mb-task-strip">
            {messages.map((m) => (
              <button
                key={messageKey(m)}
                aria-pressed={key === messageKey(m)}
                onClick={() => setSelected(messageKey(m))}
              >
                {messageLabels[m.kind]} ·{' '}
                {new Date(m.received_at).toLocaleDateString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                })}
                {!m.viewed_at && (
                  <span className="mb-unseen-dot" aria-label="未查看" />
                )}
              </button>
            ))}
          </div>
        </DragRail>
      )}
      <div className="mb-detail-toolbar">
        <nav aria-label="消息内容">
          <button aria-current="page">消息</button>
          {onDecisions && <button onClick={onDecisions}>待确认事项</button>}
        </nav>
        <span className="mb-current-status">
          {detail?.viewed_at ? '已查看' : '收到的消息'}
        </span>
      </div>
      {error ? (
        <div role="alert">
          {error}{' '}
          <button onClick={() => setRetry((v) => v + 1)}>重试读取</button>
        </div>
      ) : !detail || messageKey(detail) !== key ? (
        <output>正在读取消息…</output>
      ) : (
        <>
          <DragRail
            label="消息正文"
            className="mb-reader-rail"
            pageGap={32}
            resetKey={key}
          >
            <article className="mb-reader">
              <h3>{plainText(detail.title)}</h3>
              <p className="mb-deadline">
                {messageLabels[detail.kind]} ·{' '}
                {new Date(detail.received_at).toLocaleString('zh-CN')}
              </p>
              <p>{plainText(detail.body) || '对方未填写附言。'}</p>
              {detail.truncated && <p>内容较长，当前展示前 12 万字。</p>}
            </article>
          </DragRail>
          <div className="mb-detail-actions">
            {onOpen && detail.kind !== 'broadcast' && (
              <button className="mb-secondary" onClick={() => onOpen(detail)}>
                {detail.kind === 'friend_request' ? '查看对方主页' : '进入对话'}
              </button>
            )}
            {viewError && (
              <button onClick={() => setRetry((v) => v + 1)}>
                {viewError} · 重试
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
