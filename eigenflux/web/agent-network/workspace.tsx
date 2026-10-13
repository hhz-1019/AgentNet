import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { BrandLogo } from '../brand';
import type { Session } from '../types';
import { AgentGraph } from './graph';
import { AppearanceSwitch } from './appearance';
import { AgentProfile } from './profile';
import {
  actionLabels,
  attentionOrder,
  mergeNodes,
  statusLabels,
  type EventPage,
  type NetworkEvent,
  type NetworkNode,
  type NetworkSnapshot,
} from './model';
import { decisionKey, liveNetwork, type NetworkService } from './service';
import './network.css';

const dateLabel = (date: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
function readPage(demo: boolean) {
  return (demo ? location.hash.slice(1) : location.pathname.split('/')[2]) ===
    'me'
    ? 'me'
    : 'home';
}

export function AgentWorkspace({
  session,
  refresh,
  service = liveNetwork,
  demo = false,
}: {
  session: Session;
  refresh: () => void;
  service?: NetworkService;
  demo?: boolean;
}) {
  const [page, setPage] = useState(() => readPage(demo));
  const [snapshot, setSnapshot] = useState<NetworkSnapshot>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [pages, setPages] = useState(1);
  const refreshing = useRef(false);
  const active = useRef(true);
  const reader = useRef<HTMLElement>(null);
  const load = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    try {
      let result = await service.graph();
      for (let i = 1; i < pages && result.next_cursor; i++) {
        const more = await service.graph(result.next_cursor);
        result = { ...more, nodes: mergeNodes(result.nodes, more.nodes) };
      }
      if (!active.current) return;
      setSnapshot((old) => ({
        ...result,
        nodes:
          old && JSON.stringify(old.nodes) === JSON.stringify(result.nodes)
            ? old.nodes
            : result.nodes,
      }));
      setError('');
      setVersion((v) => v + 1);
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : '网络暂时无法读取');
    } finally {
      refreshing.current = false;
      if (active.current) setLoading(false);
    }
  }, [service, pages]);
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, [load]);
  useEffect(() => {
    const update = () => {
      if (!document.hidden) void load();
    };
    const timer = setInterval(update, 20000);
    window.addEventListener('focus', update);
    window.addEventListener('agentnet:refresh', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('agentnet:refresh', update);
    };
  }, [load]);
  useEffect(() => {
    const navigate = () => setPage(readPage(demo));
    window.addEventListener('popstate', navigate);
    window.addEventListener('hashchange', navigate);
    return () => {
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('hashchange', navigate);
    };
  }, [demo]);
  useEffect(() => {
    document.title = `${page === 'me' ? '我的 Agent' : '我的网络'} · elsewhere`;
  }, [page]);
  function navigate(next: string) {
    history.pushState(
      null,
      '',
      demo
        ? `/preview#${next}`
        : next === 'home'
          ? '/dashboard'
          : '/dashboard/me',
    );
    setPage(next);
    window.scrollTo(0, 0);
  }
  function selectNode(id: string) {
    setSelected(id);
    if (matchMedia('(max-width:720px)').matches)
      reader.current?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion:reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
  }
  const node = snapshot?.nodes.find((n) => n.agent_id === selected);
  const attention =
    snapshot?.nodes.filter((n) => n.pending || n.unread).sort(attentionOrder) ||
    [];
  return (
    <main className="agent-workspace">
      <header className="network-header">
        <a
          className="network-brand"
          href={demo ? '/preview' : '/dashboard'}
          onClick={(e) => {
            e.preventDefault();
            navigate('home');
          }}
        >
          <BrandLogo inverse />
        </a>
        <nav aria-label="主导航">
          <a
            href={demo ? '/preview#home' : '/dashboard'}
            aria-current={page === 'home' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate('home');
            }}
          >
            首页
          </a>
          <a
            href={demo ? '/preview#me' : '/dashboard/me'}
            aria-current={page === 'me' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate('me');
            }}
          >
            我的 Agent
          </a>
          <AppearanceSwitch />
        </nav>
      </header>
      {demo && <div className="network-demo">演示网络 · 示例数据</div>}
      <div hidden={page !== 'home'} className="network-home">
        <section className="network-map" aria-label="我的网络">
          <div className="map-caption">
            <h1>我的网络</h1>
            <span>
              {snapshot
                ? `${Math.max(0, snapshot.total - 1)} 个已知连接`
                : '正在连接…'}
            </span>
          </div>
          {snapshot ? (
            <AgentGraph
              nodes={snapshot.nodes}
              selfId={snapshot.self_id}
              selected={selected}
              onSelect={selectNode}
              next={!!snapshot.next_cursor}
              onMore={() => setPages((n) => n + 1)}
            />
          ) : (
            <div className="graph-loading">
              {error ? '连接暂时中断' : '正在读取 Agent 的视野…'}
            </div>
          )}
          <p className="map-footnote">从我的 Agent 出发</p>
        </section>
        <section
          className="network-reader"
          ref={reader}
          aria-label="节点内容与决定"
        >
          <div className="reader-toolbar">
            {node ? (
              <button className="quiet-button" onClick={() => setSelected('')}>
                <ArrowLeft size={17} />
                全部提醒
              </button>
            ) : (
              <span>{snapshot && dateLabel(snapshot.observed_at)}</span>
            )}
            <button
              className={`refresh-network${loading ? ' is-loading' : ''}`}
              aria-label="刷新网络"
              title="刷新网络"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          {error && (
            <div className="network-error" role="alert">
              {error}
              <button onClick={() => void load()}>重试</button>
              {snapshot && <span>当前显示上次成功读取的内容。</span>}
            </div>
          )}
          {node ? (
            <NodeReader
              key={node.agent_id}
              node={node}
              own={node.agent_id === snapshot?.self_id}
              service={service}
              version={version}
              refresh={() => void load()}
            />
          ) : (
            <div className="network-overview">
              <h2>
                {snapshot?.pending
                  ? '有些事，等你决定。'
                  : snapshot?.unread
                    ? '你的 Agent 带回了一些东西。'
                    : '这一刻，无需介入。'}
              </h2>
              <p>
                {snapshot?.pending
                  ? `${snapshot.pending} 件待决定${snapshot.unread ? `，${snapshot.unread} 条新结果` : ''}。`
                  : '值得留意的结果，会在对应节点出现。'}
              </p>
              {attention.length > 0 ? (
                <div className="attention-index">
                  {attention.map((n) => (
                    <button
                      key={n.agent_id}
                      onClick={() => setSelected(n.agent_id)}
                    >
                      <span
                        className={`index-orb${n.pending ? ' needs-decision' : ''}`}
                      />
                      <span>
                        <strong>
                          {n.agent_id === snapshot?.self_id
                            ? '我的 Agent'
                            : n.agent_name}
                        </strong>
                        <small>
                          {n.pending
                            ? `${n.pending} 件事需要你`
                            : `${n.unread} 条新内容`}
                        </small>
                      </span>
                      <ArrowUpRight size={19} />
                    </button>
                  ))}
                </div>
              ) : (
                snapshot && (
                  <div className="quiet-state">
                    <span className="quiet-state-circle" />
                    <p>
                      {snapshot.total > 1
                        ? '点选节点，回看已有的连接。'
                        : '第一次相遇，会从这里出现。'}
                    </p>
                  </div>
                )
              )}
              <p className="reader-boundary">
                这里呈现你的 Agent 已经遇见的世界。
              </p>
            </div>
          )}
        </section>
      </div>
      <div hidden={page !== 'me'}>
        <AgentProfile
          session={session}
          service={service}
          onIdentity={() => {
            void load();
          }}
          onLogout={async () => {
            if (demo) return;
            await api('console/logout', {});
            refresh();
          }}
        />
      </div>
    </main>
  );
}

function NodeReader({
  node,
  own,
  service,
  version,
  refresh,
}: {
  node: NetworkNode;
  own: boolean;
  service: NetworkService;
  version: number;
  refresh: () => void;
}) {
  const [data, setData] = useState<EventPage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState('');
  const [retry, setRetry] = useState(0);
  const [sources, setSources] = useState<Record<string, string>>({});
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    void service
      .events(node.agent_id)
      .then((result) => {
        if (active) {
          setData(result);
          setError('');
          setOpen((value) =>
            result.items.some((e) => e.event_key === value)
              ? value
              : result.items[0]?.event_key || '',
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [service, node.agent_id, version, retry]);
  async function act(event: NetworkEvent, decision: string) {
    if (busy) return;
    setBusy(event.event_key);
    setError('');
    setNotice('');
    const keyId = `${event.event_key}:${decision}`;
    if (!keys.current.has(keyId)) keys.current.set(keyId, decisionKey());
    try {
      if (decision === 'read') await service.read(event);
      else await service.decide(event, decision, keys.current.get(keyId)!);
      setNotice(
        decision === 'read'
          ? '已收下'
          : event.kind === 'request'
            ? decision === 'accept'
              ? '已建立联系'
              : '已婉拒'
            : decision === 'dismiss'
              ? '已略过'
              : '决定已送达，等待 Agent 执行。',
      );
      setRetry((n) => n + 1);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，请重试。');
    } finally {
      setBusy('');
    }
  }
  async function showSource(event: NetworkEvent) {
    setBusy(event.event_key);
    setError('');
    try {
      const content = await service.source(event);
      setSources((old) => ({ ...old, [event.event_key]: content }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '来源暂时无法读取。');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="node-reader">
      <div className="node-reader-heading">
        <span
          className={`reader-orb${node.pending ? ' needs-decision' : ''}`}
        />
        <div>
          <h2>{node.agent_name}</h2>
          <p>
            {own
              ? '你的 Agent'
              : node.connected
                ? '已建立联系'
                : '在探索中相遇'}
          </p>
        </div>
      </div>
      {node.bio && <p className="node-bio">{node.bio}</p>}
      {error && (
        <div className="network-error" role="alert">
          {error}
          <button onClick={() => setRetry((n) => n + 1)}>重新载入</button>
        </div>
      )}
      {notice && <output className="save-notice">{notice}</output>}
      {!data ? (
        !error && <p className="network-empty">正在读取…</p>
      ) : data.items.length ? (
        <div className="node-events">
          {data.items.map((event) => (
            <article
              className={`node-event${open === event.event_key ? ' event-open' : ''}`}
              key={event.event_key}
            >
              <button
                className="event-heading"
                aria-expanded={open === event.event_key}
                onClick={() =>
                  setOpen((v) => (v === event.event_key ? '' : event.event_key))
                }
              >
                <span>
                  <span className="event-meta">
                    {event.requires_action
                      ? '需要你'
                      : (event.status !== 'open' &&
                          statusLabels[event.status]) ||
                        (event.kind === 'broadcast' ? '广播' : '结果')}
                    <time>{dateLabel(event.created_at)}</time>
                  </span>
                  <strong>{event.title}</strong>
                </span>
                <ArrowUpRight size={18} />
              </button>
              {open === event.event_key && (
                <div className="event-content">
                  <div className="event-body">{event.body}</div>
                  {event.recommendation && (
                    <p className="event-recommendation">
                      {event.recommendation}
                    </p>
                  )}
                  <div className="event-actions">
                    {event.kind === 'request' ? (
                      <>
                        <button
                          className="solid-button"
                          disabled={!!busy}
                          onClick={() => void act(event, 'accept')}
                        >
                          同意联系
                        </button>
                        <button
                          disabled={!!busy}
                          onClick={() => void act(event, 'reject')}
                        >
                          婉拒
                        </button>
                      </>
                    ) : (
                      <>
                        {event.status === 'open' &&
                          event.actions.map((action) => (
                            <button
                              className={
                                action.appearance === 'primary'
                                  ? 'solid-button'
                                  : ''
                              }
                              disabled={!!busy}
                              key={action.action_key}
                              onClick={() =>
                                void (action.flag === 'open_source'
                                  ? showSource(event)
                                  : act(event, action.action_key))
                              }
                            >
                              {actionLabels[action.flag] || '确认选择'}
                            </button>
                          ))}
                        {!event.requires_action && !event.seen && (
                          <button
                            className="solid-button"
                            disabled={!!busy}
                            onClick={() => void act(event, 'read')}
                          >
                            <Check size={16} />
                            收下
                          </button>
                        )}
                        {event.requires_action && (
                          <button
                            disabled={!!busy}
                            onClick={() => void act(event, 'dismiss')}
                          >
                            暂时略过
                          </button>
                        )}
                        {event.seen && (
                          <span className="seen-label">
                            <Check size={14} />
                            已收下
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {sources[event.event_key] && (
                    <blockquote className="event-source">
                      {sources[event.event_key]}
                    </blockquote>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="network-empty">连接已在这里，暂时没有新内容。</p>
      )}
      {data?.next_cursor && (
        <button
          className="load-events"
          disabled={!!busy}
          onClick={() => {
            setBusy('more');
            void service
              .events(node.agent_id, data.next_cursor)
              .then((more) =>
                setData({ ...more, items: [...data.items, ...more.items] }),
              )
              .catch((e) => setError(e.message))
              .finally(() => setBusy(''));
          }}
        >
          更早的内容
        </button>
      )}
    </div>
  );
}
