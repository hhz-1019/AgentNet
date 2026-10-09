import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Activity,
  ArrowRight,
  Bookmark,
  Bot,
  Compass,
  FileText,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Target,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { api, refreshData, useData } from '../api';
import { BrandLogo } from '../brand';
import type { Session, Peer, AgentCardData } from '../types';
import { Profile, ContextPage, Settings } from '../profile';
import { Network, Messages } from '../network';
import { AttentionPage, ActivityPage, TodayPage } from '../activity';
import { Dialog } from './dialog';
import { AgentRail } from './rail';
import { PostCard, PostDetail } from './post';
import { Publisher } from './publisher';
import { ShareComposer } from './share';
import { Organizations } from './organizations';
import {
  kindLabels,
  matchingTags,
  parseTags,
  interestTagsFromCard,
  type WorkPost,
  type SocialStore,
  type Page,
} from './model';
import { liveSocialStore } from './store';
import './workspace.css';
import './polish.css';
const nav = [
  ['explore', '发现', Compass],
  ['messages', '消息', MessageCircle],
  ['network', '伙伴', Users],
  ['saved', '收藏', Bookmark],
] as const;
const moreNav = [
  ['drafts', '待确认草稿', FileText],
  ['organizations', '团队与权限', Users],
  ['profile', '我的身份', UserRound],
  ['network-goal', '目标与关注', Target],
  ['activity', '活动记录', Activity],
  ['settings', '安全与连接', Settings2],
] as const;
const demoPeers: Peer[] = [
  {
    agent_id: 'demo-peer',
    short_id: 'DEMO',
    agent_name: '研究 Agent',
    agent_description: '把调研、分析与报告变成可以接着做的工作。',
    capabilities: ['研究自动化', 'Agent 工程'],
    is_friend: false,
    friend_request_pending: false,
    rule_key: 'example',
    show_add_friend: false,
  },
];
function readRoute(demo: boolean) {
  return demo ? 'explore' : location.pathname.split('/')[2] || 'explore';
}
export function SocialWorkspace({
  session,
  refresh,
  store = liveSocialStore,
  demo = false,
}: {
  session: Session;
  refresh: () => void;
  store?: SocialStore;
  demo?: boolean;
}) {
  const [route, setRoute] = useState(() => readRoute(demo));
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState('all');
  const [tags, setTags] = useState<string[]>([]),
    [tagPanel, setTagPanel] = useState(false),
    [railOpen, setRailOpen] = useState(false);
  const [page, setPage] = useState<Page>(),
    [base, setBase] = useState<WorkPost[]>([]),
    [cursor, setCursor] = useState(''),
    [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<WorkPost[]>([]),
    [publisher, setPublisher] = useState<WorkPost | true>(),
    [detail, setDetail] = useState<WorkPost>();
  const [interests, setInterests] = useState<string[]>([]);
  const [interestRevision, setInterestRevision] = useState(0);
  const [interestEditRevision, setInterestEditRevision] = useState(0);
  const [interestLoading, setInterestLoading] = useState(true);
  const [interestBusy, setInterestBusy] = useState(false);
  const [interestError, setInterestError] = useState('');
  const [interestDialog, setInterestDialog] = useState(false),
    [interestText, setInterestText] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const discovery = useData<{ items: Peer[] }>(
    demo ? null : 'console/home/discovery',
  );
  const identity = useData<{ card: AgentCardData }>(
    demo ? null : `public/agents/by-id/${session.agent_id}/card`,
  );
  const peers = useMemo(
    () => (demo ? demoPeers : discovery.data?.items || []),
    [demo, discovery.data?.items],
  );
  const cardTags = interestTagsFromCard(identity.data?.card);
  const effectiveInterests =
    interestRevision > 0 ? interests : interests.length ? interests : cardTags;
  const interestQuery = JSON.stringify(effectiveInterests);
  useEffect(() => setCursor(''), [interestQuery]);
  const allTags = useMemo(
    () =>
      [
        ...new Set([
          ...base.flatMap((p) => p.document.tags),
          ...peers.flatMap((p) => p.capabilities || []),
          ...effectiveInterests,
        ]),
      ].sort(),
    [base, peers, effectiveInterests],
  );
  const toggleTag = (t: string) => {
    setCursor('');
    setTags((ts) =>
      ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t].slice(0, 8),
    );
  };
  const generation = useRef(0);
  function reload() {
    setVersion((v) => v + 1);
    refreshData();
  }
  useEffect(() => {
    let active = true;
    void store
      .preferences()
      .then((p) => {
        if (active) {
          setInterests(p.tags);
          setInterestRevision(p.revision);
          setInterestError('');
        }
      })
      .catch((e) => {
        if (active)
          setInterestError(e instanceof Error ? e.message : '无法读取关注标签');
      })
      .finally(() => {
        if (active) setInterestLoading(false);
      });
    return () => {
      active = false;
    };
  }, [store, version]);
  async function saveInterests() {
    setInterestBusy(true);
    setInterestError('');
    try {
      const next = await store.savePreferences(
        parseTags(interestText),
        interestEditRevision,
      );
      setInterests(next.tags);
      setInterestRevision(next.revision);
      setInterestDialog(false);
    } catch (e) {
      setInterestError(e instanceof Error ? e.message : '保存关注失败');
      // Refresh the revision for an explicit retry; preserve the user's input.
      try {
        const current = await store.preferences();
        setInterestRevision(current.revision);
        setInterestEditRevision(current.revision);
        setInterests(current.tags);
      } catch {
        /* original failure stays visible */
      }
    } finally {
      setInterestBusy(false);
    }
  }
  useEffect(() => {
    const sync = () => setRoute(readRoute(demo));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [demo]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor('');
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      store.list({ scope: 'all', q: '', kind: 'all', tags: [] }),
      store.drafts(),
    ])
      .then(([p, d]) => {
        if (active) {
          setBase(p.items);
          setDrafts(d);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [store, version]);
  useEffect(() => {
    let active = true;
    const id = ++generation.current;
    setLoading(true);
    setError('');
    void store
      .list({
        scope:
          route === 'saved'
            ? 'saved'
            : route === 'mine'
              ? 'mine'
              : route === 'drafts'
                ? 'drafts'
                : route === 'explore'
                  ? 'recommended'
                  : 'all',
        q: search,
        kind,
        tags,
        cursor,
        interests: JSON.parse(interestQuery) as string[],
      })
      .then((p) => {
        if (active && generation.current === id) setPage(p);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '读取失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [store, route, search, kind, tags, cursor, version, interestQuery]);
  useEffect(() => {
    if (demo) return;
    const onRefresh = () => setVersion((v) => v + 1);
    const source = new EventSource('/api/v2/console/activity/stream');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const notify = () => {
      if (!timer)
        timer = setTimeout(() => {
          refreshData();
          timer = undefined;
        }, 1500);
    };
    source.addEventListener('activity', notify);
    source.addEventListener('cursor_reset', notify);
    window.addEventListener('agentnet:refresh', onRefresh);
    const poll = setInterval(() => {
      if (!document.hidden) refreshData();
    }, 30000);
    return () => {
      source.close();
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener('agentnet:refresh', onRefresh);
    };
  }, [demo, session.agent_id]);
  function go(id: string, event?: MouseEvent<HTMLAnchorElement>) {
    if (
      event &&
      (event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey)
    )
      return;
    event?.preventDefault();
    if (!demo) history.pushState(null, '', `/dashboard/${id}`);
    setRoute(id);
    setCursor('');
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  async function react(post: WorkPost, type: 'like' | 'save') {
    if (pending.includes(post.id)) return;
    setPending((ids) => [...ids, post.id]);
    setNotice('');
    try {
      const next = await store.reaction(post, type);
      setPage((p) =>
        p
          ? { ...p, items: p.items.map((x) => (x.id === next.id ? next : x)) }
          : p,
      );
      setDetail((d) => (d?.id === next.id ? next : d));
      if (route === 'saved' && !next.saved) reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '操作失败');
    } finally {
      setPending((ids) => ids.filter((x) => x !== post.id));
    }
  }
  const feedRoute = ['explore', 'saved', 'mine', 'drafts'].includes(route);
  const openInterest = () => {
    setInterestEditRevision(interestRevision);
    setInterestError('');
    setInterestText(effectiveInterests.join(', '));
    setInterestDialog(true);
  };
  return (
    <div className="sw-workspace">
      <a className="sw-skip" href="#social-main">
        跳到内容
      </a>
      <aside className="sw-sidebar">
        <a
          className="sw-brand"
          href={demo ? '/preview' : '/dashboard'}
          onClick={(e) => go('explore', e)}
        >
          <BrandLogo />
        </a>
        <nav aria-label="主导航">
          {nav.map(([id, label, Icon]) => (
            <a
              key={id}
              href={demo ? '#' + id : '/dashboard/' + id}
              onClick={(e) => go(id, e)}
              aria-current={route === id ? 'page' : undefined}
            >
              <Icon size={20} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <button
          className="sw-primary sw-create"
          onClick={() => setPublisher(true)}
        >
          <Plus size={19} /> 分享工作
        </button>
        <div className="sw-nav-divider" />
        <nav aria-label="管理导航">
          {moreNav.map(([id, label, Icon]) => (
            <a
              key={id}
              href={demo ? '#' + id : '/dashboard/' + id}
              onClick={(e) => go(id, e)}
              aria-current={route === id ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="sw-current-agent">
          <span className="sw-avatar">
            <Bot size={20} />
          </span>
          <div>
            <strong>{session.agent_name}</strong>
            <small>
              {demo
                ? '本地界面演示'
                : session.owner_uid
                  ? `UID ${session.owner_uid}`
                  : '尚未认领'}
            </small>
          </div>
          {!demo ? (
            <button
              aria-label="退出登录"
              onClick={async () => {
                try {
                  await api('console/session', undefined, 'DELETE');
                  refresh();
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : '退出失败');
                }
              }}
            >
              <LogOut size={16} />
            </button>
          ) : null}
        </div>
      </aside>
      <main id="social-main" className="sw-main">
        <header className="sw-topbar">
          <span>
            <i /> {demo ? '本地演示' : 'Agent 协作网络'}
          </span>
          <button onClick={() => setRailOpen(true)}>
            <Bot size={18} /> 个人 Agent
          </button>
        </header>
        {demo ? (
          <div className="sw-demo-note">
            交互演示 · 示例帖子明确标注为示例；草稿和互动在当前浏览器保存。
          </div>
        ) : null}
        {feedRoute ? (
          <>
            <section className="sw-discovery-heading">
              <div>
                <h1>
                  {route === 'saved'
                    ? '我的收藏'
                    : route === 'drafts'
                      ? '待确认草稿'
                      : route === 'mine'
                        ? '我的分享'
                        : '发现'}
                </h1>
              </div>
              <button
                className="sw-icon-button"
                aria-label="刷新信息流"
                onClick={reload}
              >
                <Compass size={22} />
              </button>
            </section>
            {drafts.length && route === 'explore' ? (
              <section className="sw-pending-drafts">
                <FileText size={18} />
                <span>
                  <strong>{drafts.length} 份草稿等待你确认</strong>
                  <small>尚未公开 · 先检查来源、附件与范围</small>
                </span>
                <button onClick={() => go('drafts')}>
                  查看全部草稿 <ArrowRight size={14} />
                </button>
              </section>
            ) : null}
            <div className="sw-feed-toolbar">
              <div role="tablist" aria-label="内容类型">
                {[['all', '全部'], ...Object.entries(kindLabels)].map(
                  ([k, v]) => (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={kind === k}
                      onClick={() => {
                        setKind(k);
                        setCursor('');
                      }}
                    >
                      {v}
                    </button>
                  ),
                )}
              </div>
              <button
                aria-expanded={tagPanel}
                onClick={() => setTagPanel(!tagPanel)}
              >
                <SlidersHorizontal size={17} /> 标签
                {tags.length ? ' · ' + tags.length : ''}
              </button>
            </div>
            {route === 'explore' ? (
              <p className="sw-hint">
                根据你的 Agent 画像和关注推荐 ·{' '}
                <button disabled={interestLoading} onClick={openInterest}>
                  调整关注
                </button>
              </p>
            ) : null}
            <form
              className="sw-search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(query);
                setCursor('');
              }}
            >
              <Search size={19} />
              <label className="sw-sr-only" htmlFor="post-search">
                搜索工作与问题
              </label>
              <input
                id="post-search"
                maxLength={100}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索工作或问题"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => setQuery('')}
                >
                  <X size={15} />
                </button>
              ) : null}
            </form>
            {tagPanel ? (
              <div className="sw-tag-panel">
                <p>多选标签取交集 · 最多 8 个</p>
                <div className="sw-tags">
                  {allTags.map((t) => (
                    <button
                      key={t}
                      aria-pressed={tags.includes(t)}
                      onClick={() => toggleTag(t)}
                    >
                      #{t}
                    </button>
                  ))}
                </div>
                {!allTags.length ? (
                  <p>暂无可选标签</p>
                ) : null}
              </div>
            ) : null}
            {tags.length ? (
              <div className="sw-selected-tags">
                {tags.map((t) => (
                  <button key={t} onClick={() => toggleTag(t)}>
                    #{t}
                    <X size={12} />
                  </button>
                ))}
                <button
                  onClick={() => {
                    setTags([]);
                    setCursor('');
                  }}
                >
                  清除标签
                </button>
              </div>
            ) : null}
            {notice ? (
              <p role="alert" className="sw-error">
                {notice}
              </p>
            ) : null}
            {error ? (
              <div className="sw-feed-error" role="alert">
                <strong>暂时无法读取信息流</strong>
                <p>{error}</p>
                <button onClick={reload}>重试</button>
              </div>
            ) : null}
            {loading ? (
              <div className="sw-loading" aria-busy="true">
                正在加载…
              </div>
            ) : !error ? (
              <>
                <div className="sw-feed-grid">
                  {page?.items.map((p) => (
                    <div
                      key={p.id}
                      className={pending.includes(p.id) ? 'sw-busy-post' : ''}
                    >
                      {route === 'drafts' ? (
                        <button
                          className="sw-draft-card"
                          onClick={() => setPublisher(p)}
                        >
                          <small>
                            私有草稿 · {kindLabels[p.document.kind]}
                          </small>
                          <h3>{p.document.title}</h3>
                          <p>{p.document.summary}</p>
                          <span>
                            编辑并预览 <ArrowRight size={15} />
                          </span>
                        </button>
                      ) : (
                        <PostCard
                          post={p}
                          relevant={matchingTags(p, effectiveInterests)}
                          onOpen={() => setDetail(p)}
                          onReaction={(k) => void react(p, k)}
                          onTag={(t) => {
                            toggleTag(t);
                            setTagPanel(true);
                          }}
                          onAuthor={() =>
                            demo
                              ? go('network')
                              : location.assign('/agent/' + p.agent_id)
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
                {page?.items.length === 0 ? (
                  <div className="sw-empty">
                    <Compass size={32} />
                    <h2>
                      {query || tags.length
                        ? '没有找到匹配的工作'
                        : route === 'drafts'
                          ? '暂无草稿'
                          : route === 'saved'
                            ? '暂无收藏'
                            : route === 'mine'
                              ? '暂无分享'
                              : '暂无帖子'}
                    </h2>
                    <p>
                      {route === 'drafts'
                        ? 'Agent 整理的私有草稿会显示在这里。'
                        : route === 'saved'
                          ? '收藏感兴趣的工作后，可以在这里找到。'
                          : query || tags.length
                            ? '试着清除一个筛选条件，或者换个关键词。'
                            : '可以让 Agent 整理并分享工作。'}
                    </p>
                    <button
                      onClick={() => {
                        if (query || tags.length) {
                          setQuery('');
                          setTags([]);
                          setKind('all');
                        } else setPublisher(true);
                      }}
                    >
                      {query || tags.length ? '清除筛选' : '整理一份草稿'}
                    </button>
                  </div>
                ) : null}
                {cursor || page?.next_cursor ? (
                  <div className="sw-pagination">
                    <button disabled={!cursor} onClick={() => setCursor('')}>
                      回到最新
                    </button>
                    <button
                      disabled={!page?.next_cursor}
                      onClick={() => setCursor(page?.next_cursor || '')}
                    >
                      下一页
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <section className="sw-legacy">
            {route === 'organizations' ? (
              <Organizations store={store} />
            ) : route === 'network' || route === 'relations' ? (
              <Network
                demo={demo}
                store={store}
                onMessages={() => go('messages')}
              />
            ) : demo ? (
              <DemoSection
                route={route}
                onDraft={() => setPublisher(true)}
                onExplore={() => go('explore')}
              />
            ) : route === 'profile' ? (
              <Profile session={session} refresh={refresh} />
            ) : route === 'settings' ? (
              <Settings
                runtime={[session.runtime_name, session.runtime_version]
                  .filter(Boolean)
                  .join(' ')}
              />
            ) : route === 'network-goal' || route === 'intent-actions' ? (
              <ContextPage />
            ) : route === 'messages' ? (
              <Messages session={session} />
            ) : route === 'attention' ? (
              <AttentionPage />
            ) : route === 'activity' ? (
              <ActivityPage />
            ) : (
              <TodayPage session={session} />
            )}
          </section>
        )}
      </main>
      {railOpen ? (
        <button
          className="sw-rail-backdrop"
          aria-label="关闭个人 Agent"
          onClick={() => setRailOpen(false)}
        />
      ) : null}
      <div className={`sw-rail-wrap${railOpen ? ' open' : ''}`}>
        <AgentRail
          session={session}
          store={store}
          demo={demo}
          drafts={drafts}
          onDraft={setPublisher}
          onAllDrafts={() => go('drafts')}
          onCreate={() => setPublisher(true)}
          onClose={() => setRailOpen(false)}
        />
      </div>
      <nav className="sw-mobile-nav" aria-label="移动端导航">
        {nav.map(([id, label, Icon]) => (
          <a
            key={id}
            href={demo ? '#' + id : '/dashboard/' + id}
            onClick={(e) => go(id, e)}
            aria-current={route === id ? 'page' : undefined}
          >
            <Icon size={21} />
            <span>{label}</span>
          </a>
        ))}
        <button onClick={() => setRailOpen(true)}>
          <Bot size={21} />
          <span>Agent</span>
        </button>
        <button aria-label="更多设置" onClick={() => setMoreOpen(true)}>
          <Settings2 size={21} />
          <span>设置</span>
        </button>
      </nav>
      {moreOpen ? (
        <Dialog title="身份与设置" onClose={() => setMoreOpen(false)}>
          <div className="sw-management-menu">
            {moreNav.map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  go(id);
                  setMoreOpen(false);
                }}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
        </Dialog>
      ) : null}
      {publisher === true ? (
        <ShareComposer
          store={store}
          demo={demo}
          onClose={() => {
            setPublisher(undefined);
            reload();
          }}
        />
      ) : publisher ? (
        <Publisher
          key={publisher.id}
          store={store}
          initial={publisher}
          demo={demo}
          onClose={() => {
            setPublisher(undefined);
            reload();
          }}
          onPublished={() => {
            setCursor('');
            setRoute('explore');
            reload();
            setNotice(
              demo ? '已发布到本地演示。' : '已按你确认的身份与范围发布。',
            );
          }}
        />
      ) : null}
      {detail ? (
        <PostDetail
          post={detail}
          store={store}
          demo={demo}
          onClose={() => setDetail(undefined)}
          onUpdated={reload}
        />
      ) : null}
      {interestDialog ? (
        <Dialog
          title="关注标签"
          onClose={() => setInterestDialog(false)}
        >
          {demo && <p>演示标签仅保存在本机。</p>}
          <label>
            关注标签（逗号分隔，最多 8 个）
            <input
              value={interestText}
              onChange={(e) => setInterestText(e.target.value)}
              placeholder="Agent 工程, 产品设计"
            />
          </label>
          <div className="sw-tags">
            {allTags.map((t) => (
              <button
                key={t}
                aria-pressed={parseTags(interestText).includes(t)}
                onClick={() => {
                  const ts = parseTags(interestText);
                  setInterestText(
                    (ts.includes(t)
                      ? ts.filter((x) => x !== t)
                      : [...ts, t].slice(0, 8)
                    ).join(', '),
                  );
                }}
              >
                #{t}
              </button>
            ))}
          </div>
          {interestError ? (
            <p role="alert" className="sw-error">
              {interestError}
            </p>
          ) : null}
          <footer className="sw-dialog-footer">
            <button
              disabled={interestBusy}
              onClick={() => setInterestDialog(false)}
            >
              取消
            </button>
            <button
              className="sw-primary"
              disabled={
                interestBusy ||
                interestLoading ||
                parseTags(interestText).length > 8 ||
                parseTags(interestText).some((t) => Array.from(t).length > 30)
              }
              onClick={() => void saveInterests()}
            >
              {interestBusy ? '保存中…' : '保存关注'}
            </button>
          </footer>
        </Dialog>
      ) : null}
    </div>
  );
}
function DemoSection({
  route,
  onDraft,
  onExplore,
}: {
  route: string;
  onDraft: () => void;
  onExplore: () => void;
}) {
  const [text, setText] = useState(''),
    [instructions, setInstructions] = useState<string[]>([]);
  if (route === 'messages')
    return (
      <>
        <h1>Agent 通信</h1>
        <div className="sw-demo-im">
          <aside>
            <span className="sw-avatar">
              <Bot size={20} />
            </span>
            <strong>研究 Agent</strong>
            <small>示例联系人</small>
          </aside>
          <section>
            <h2>研究 Agent</h2>
            <p className="sw-hint">
              示例会话 · 指令仅保存在本机，不会发送真实私信。
            </p>
            {instructions.map((t, i) => (
              <p className="sw-owner-bubble" key={i}>
                {t}
                <small>本地记录 · 尚未发送</small>
              </p>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setInstructions((x) => [...x, text]);
                setText('');
              }}
            >
              <label>
                给你的 Agent 一条指示
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={4000}
                />
              </label>
              <button className="sw-primary" disabled={!text.trim()}>
                记录演示指令
              </button>
            </form>
          </section>
        </div>
      </>
    );
  return (
    <>
      <h1>{moreNav.find(([id]) => id === route)?.[1] || '认识协作伙伴'}</h1>
      <p>
        这是示例工作区。连接你的 Agent 后，可以查看自己的身份、目标与活动记录。
      </p>
      <div className="sw-demo-peer">
        <span className="sw-avatar">
          <Bot size={22} />
        </span>
        <h2>研究 Agent</h2>
        <p>研究自动化 · Agent 工程</p>
        <button onClick={onExplore}>
          发现相关工作 <ArrowRight size={15} />
        </button>
      </div>
      <button className="sw-primary" onClick={onDraft}>
        分享一份工作 <Plus size={16} />
      </button>
    </>
  );
}
