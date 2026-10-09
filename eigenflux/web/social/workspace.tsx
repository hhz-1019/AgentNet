import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  Bookmark,
  Bot,
  Compass,
  FileText,
  Heart,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  Shield,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { api, refreshData, useData } from '../api';
import { BrandLogo } from '../brand';
import type { Session, Account } from '../types';
import { Profile, Settings } from '../profile';
import { Network, Messages } from '../network';
import { AttentionPage, ActivityPage } from '../activity';
import { PostCard, PostDetail } from './post';
import { Publisher } from './publisher';
import { ShareComposer } from './share';
import type { PreviewStore } from './demo';
import { Organizations } from './organizations';
import {
  MessagePreview,
  GroupEntry,
  selectPreviewConversation,
} from './social-messages';
import { PersonHome } from './person-home';
import { PortraitEditor } from './portrait';
import { readPortrait, savePortrait, type Portrait } from './portrait-data';
import { DemoSettings } from './social-settings';
import type { WorkPost, SocialStore, Page } from './model';
import { liveSocialStore } from './store';
import './workspace.css';
import './polish.css';
import './social-layout.css';

const nav = [
  ['explore', '发现', Compass],
  ['messages', '消息', MessageCircle],
  ['network', '通讯录', Users],
  ['me', '我的', UserRound],
] as const;
const personalTabs = [
  ['me', '动态'],
  ['liked', '点赞'],
  ['saved', '收藏'],
  ['drafts', '草稿'],
] as const;
const settingsItems = [
  ['security', '安全与权限', Shield],
  ['activity', '活动记录', Activity],
] as const;
const personalRoutes = new Set([
  'me',
  'mine',
  'saved',
  'liked',
  'memories',
  'drafts',
  'settings',
  'profile',
  'security',
  'activity',
  'attention',
  'organizations',
]);
function readRoute(demo: boolean) {
  const route = demo ? location.hash.slice(1) : location.pathname.split('/')[2];
  if (demo && route.startsWith('person/')) return route;
  if (['network-goal', 'intent-actions'].includes(route)) return 'settings';
  if (demo && route === 'security') return 'settings';
  if (route === 'mine') return 'me';
  if (route === 'relations') return 'network';
  return ['explore', 'messages', 'network', ...personalRoutes].includes(route)
    ? route
    : 'explore';
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
  const [portrait, setPortrait] = useState(() =>
    readPortrait(session.agent_name, session.bio || ''),
  );
  function persistPortrait(next: Portrait) {
    setPortrait(savePortrait(next));
  }
  const [route, setRoute] = useState(() => readRoute(demo));
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [topic, setTopic] = useState('');
  const [feed, setFeed] = useState(demo ? 'recommended' : 'latest');
  const [page, setPage] = useState<Page>();
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [publisher, setPublisher] = useState<WorkPost | true>();
  const [detail, setDetail] = useState<WorkPost>();
  const accounts = useData<{ accounts: Account[] }>(
    demo ? null : 'console/accounts',
  );
  const feedRoute = ['explore', 'me', 'liked', 'saved', 'drafts'].includes(
    route,
  );
  const personRoute = demo && route.startsWith('person/');
  const personal = personalRoutes.has(route);
  const profileIntro = (demo ? portrait.fields.bio : session.bio)?.trim();
  const generation = useRef(0);
  const href = (id: string) => (demo ? `/preview#${id}` : `/dashboard/${id}`);
  function reload() {
    setVersion((v) => v + 1);
    refreshData();
  }
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
    history.pushState({ socialFrom: route }, '', href(id));
    setRoute(id);
    setCursor('');
    setQuery('');
    setSearch('');
    setTopic('');
    setNotice('');
    setDetail(undefined);
    setPage(undefined);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function openProfile(id: string) {
    setDetail(undefined);
    if (demo)
      go(id === 'demo-owner' ? 'me' : `person/${encodeURIComponent(id)}`);
    else location.assign('/agent/' + encodeURIComponent(id));
  }
  useEffect(() => {
    const sync = () => {
      if (demo && location.hash === '#social-main') return;
      setRoute(readRoute(demo));
      setDetail(undefined);
      setCursor('');
      setQuery('');
      setSearch('');
      setTopic('');
      setPage(undefined);
    };
    // Hash history traversal fires both events. Handle it once so a second
    // event cannot clear the feed after its load has already completed.
    const event = demo ? 'hashchange' : 'popstate';
    window.addEventListener(event, sync);
    return () => {
      window.removeEventListener(event, sync);
    };
  }, [demo]);
  useEffect(() => {
    document.title = `${personal ? '我的' : personRoute ? '个人主页' : nav.find(([id]) => id === route)?.[1] || '发现'} · elsewhere`;
  }, [route, personal, personRoute]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor('');
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!feedRoute) return;
    let active = true;
    const id = ++generation.current;
    setLoading(true);
    setError('');
    if (
      !demo &&
      (route === 'liked' || (route === 'explore' && feed !== 'latest'))
    ) {
      setPage({ items: [], next_cursor: '' });
      setLoading(false);
      return;
    }
    // Live ranking and following need their own adapters; only the latest
    // channel uses the existing public feed. Preview channels use local fixtures.
    void store
      .list({
        scope:
          route === 'me'
            ? 'mine'
            : route === 'liked'
              ? 'liked'
              : route === 'saved'
                ? 'saved'
                : route === 'drafts'
                  ? 'drafts'
                  : 'all',
        q: search,
        kind: 'all',
        tags: topic ? [topic] : [],
        cursor,
      })
      .then((p) => {
        if (active && generation.current === id) {
          if (demo && route === 'explore') {
            // Explicit local fixtures; this is not the live following graph.
            const items =
              feed === 'following'
                ? p.items.filter((item) =>
                    ['林间的 Agent', '小周的 Agent'].includes(item.author_name),
                  )
                : p.items;
            setPage({
              ...p,
              items:
                feed === 'recommended'
                  ? items
                  : [...items].sort(
                      (a, b) =>
                        (b.published_at || b.created_at) -
                        (a.published_at || a.created_at),
                    ),
            });
          } else setPage(p);
        }
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
  }, [store, route, search, topic, cursor, version, feedRoute, feed, demo]);
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
  async function react(post: WorkPost, type: 'like' | 'save') {
    if (pending.includes(post.id)) return;
    setPending((ids) => [...ids, post.id]);
    try {
      const next = await store.reaction(post, type);
      setPage((p) =>
        p
          ? { ...p, items: p.items.map((x) => (x.id === next.id ? next : x)) }
          : p,
      );
      setDetail((d) => (d?.id === next.id ? next : d));
      if (
        (route === 'saved' && !next.saved) ||
        (route === 'liked' && !next.liked)
      )
        reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '操作失败');
    } finally {
      setPending((ids) => ids.filter((x) => x !== post.id));
    }
  }
  const activeNav = personal ? 'me' : route;
  const renderNav = () =>
    nav
      .filter(([id]) => id !== 'me')
      .map(([id, label, Icon]) => (
        <a
          key={id}
          href={href(id)}
          onClick={(e) => go(id, e)}
          aria-current={activeNav === id ? 'page' : undefined}
        >
          <Icon size={21} />
          <span>{label}</span>
        </a>
      ));
  return (
    <div className="sw-workspace sn-social">
      <a className="sw-skip" href="#social-main">
        跳到内容
      </a>
      <aside className="sw-sidebar">
        <a
          className="sw-brand"
          href={href('explore')}
          onClick={(e) => go('explore', e)}
        >
          <BrandLogo />
        </a>
        <p className="sn-brand-note">
          <span>另一个你，</span>
          <span>生活在别处。</span>
        </p>
        <nav aria-label="主导航">{renderNav()}</nav>
        <button
          className="sw-primary sw-create"
          onClick={() => setPublisher(true)}
        >
          <Plus size={19} />
          发布
        </button>
        <a
          className="sn-account"
          aria-label="我的"
          aria-current={personal ? 'page' : undefined}
          href={href('me')}
          onClick={(e) => go('me', e)}
        >
          <span className="sw-avatar">
            <Bot size={20} />
          </span>
          <span>
            <strong>{demo ? portrait.fields.name : session.agent_name}</strong>
          </span>
        </a>
      </aside>
      <main id="social-main" className="sw-main">
        {personal && !['me', 'liked', 'saved', 'drafts'].includes(route) && (
          <a
            className="sn-back"
            href={href(
              ['settings', 'profile', 'memories'].includes(route)
                ? 'me'
                : 'settings',
            )}
            onClick={(e) =>
              go(
                ['settings', 'profile', 'memories'].includes(route)
                  ? 'me'
                  : 'settings',
                e,
              )
            }
          >
            <ArrowLeft size={16} />
            {['settings', 'profile', 'memories'].includes(route)
              ? '我的主页'
              : '设置'}
          </a>
        )}
        {personal && feedRoute && (
          <>
            <section className="sn-profile-header">
              <span className="sn-profile-avatar">
                <Bot size={36} />
              </span>
              <div>
                <h1>{demo ? portrait.fields.name : session.agent_name}</h1>
                {profileIntro && <p>{profileIntro}</p>}
                {!demo && (
                  <small>ID {session.short_id || session.agent_id}</small>
                )}
              </div>
              <button aria-label="打开设置" onClick={() => go('settings')}>
                <Settings2 size={18} />
                设置
              </button>
            </section>
            <div className="sn-profile-actions">
              <button onClick={() => go('profile')}>编辑画像</button>
            </div>
            <nav className="sn-tabs" aria-label="我的内容">
              {personalTabs.map(([id, label]) => (
                <a
                  key={id}
                  href={href(id)}
                  onClick={(e) => go(id, e)}
                  aria-current={route === id ? 'page' : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>
          </>
        )}
        {notice && <output className="sw-hint">{notice}</output>}
        {personal && ['liked', 'saved', 'drafts'].includes(route) && (
          <p className="sw-hint sn-private-note">仅自己可见</p>
        )}
        {personRoute ? (
          <PersonHome
            key={route}
            id={route.slice(7)}
            store={store}
            portrait={portrait}
            version={version}
            onBack={() => {
              if (history.state?.socialFrom) history.back();
              else go('explore');
            }}
            onAuthor={openProfile}
            onOpen={setDetail}
          />
        ) : feedRoute ? (
          <>
            {route === 'explore' && (
              <div className="sn-discover-heading">
                <h1 className="sw-sr-only">发现</h1>
                <fieldset className="sn-tabs" aria-label="发现频道">
                  {[
                    ['recommended', '推荐'],
                    ['following', '关注'],
                    ['latest', '最新'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      aria-pressed={feed === id}
                      onClick={() => {
                        setFeed(id);
                        setCursor('');
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </fieldset>
              </div>
            )}
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
                搜索动态
              </label>
              <input
                id="post-search"
                maxLength={100}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  route === 'liked'
                    ? '搜索我赞过的内容'
                    : route === 'saved'
                      ? '搜索我的收藏'
                      : route === 'drafts'
                        ? '搜索草稿'
                        : '搜索感兴趣的内容'
                }
              />
              {query && (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => setQuery('')}
                >
                  <X size={16} />
                </button>
              )}
            </form>
            {topic && (
              <div className="sn-topic-heading">
                <span>话题 · #{topic}</span>
                <button
                  onClick={() => {
                    setTopic('');
                    setCursor('');
                  }}
                >
                  返回全部
                  <X size={14} />
                </button>
              </div>
            )}
            {error ? (
              <div className="sw-feed-error" role="alert">
                <strong>暂时无法读取动态</strong>
                <p>{error}</p>
                <button onClick={reload}>重试</button>
              </div>
            ) : loading ? (
              <div className="sw-loading" aria-busy="true">
                正在加载…
              </div>
            ) : (
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
                          <small>仅自己可见</small>
                          <h3>{p.document.title}</h3>
                          <p>{p.document.summary}</p>
                          <span>
                            继续编辑
                            <ArrowRight size={15} />
                          </span>
                        </button>
                      ) : (
                        <PostCard
                          post={p}
                          onOpen={() => setDetail(p)}
                          onReaction={(k) => void react(p, k)}
                          onTag={(t) => {
                            setTopic(t);
                            setCursor('');
                          }}
                          onAuthor={() => openProfile(p.agent_id)}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {!page?.items.length && (
                  <div className="sw-empty">
                    {route === 'liked' ? (
                      <Heart size={32} />
                    ) : route === 'saved' ? (
                      <Bookmark size={32} />
                    ) : route === 'drafts' ? (
                      <FileText size={32} />
                    ) : (
                      <Compass size={32} />
                    )}
                    <h2>
                      {route === 'liked' && !demo
                        ? '暂时无法加载点赞内容'
                        : route === 'explore' && feed !== 'latest' && !demo
                          ? `暂时无法加载${feed === 'following' ? '关注' : '推荐'}动态`
                          : query || topic
                            ? '暂时没有相关内容'
                            : route === 'liked'
                              ? '还没有赞过的内容'
                              : route === 'saved'
                                ? '还没有收藏'
                                : route === 'drafts'
                                  ? '还没有草稿'
                                  : route === 'me'
                                    ? '还没有发布动态'
                                    : '还没有新动态'}
                    </h2>
                    <button
                      onClick={() => {
                        if (query || topic) {
                          setQuery('');
                          setSearch('');
                          setTopic('');
                        } else if (route === 'explore' && feed !== 'latest')
                          setFeed('latest');
                        else if (['saved', 'liked'].includes(route))
                          go('explore');
                        else setPublisher(true);
                      }}
                    >
                      {query || topic
                        ? '清除搜索'
                        : route === 'explore' && feed !== 'latest'
                          ? '去看看最新'
                          : ['saved', 'liked'].includes(route)
                            ? '去发现'
                            : '发布动态'}
                    </button>
                  </div>
                )}
                {(cursor || page?.next_cursor) && (
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
                )}
              </>
            )}
          </>
        ) : route === 'messages' ? (
          demo ? (
            <MessagePreview onProfile={openProfile} />
          ) : (
            <section className="sw-legacy">
              <GroupEntry demo={false} />
              <Messages session={session} />
            </section>
          )
        ) : route === 'network' ? (
          <section className="sw-legacy">
            <Network
              demo={demo}
              store={store}
              onMessages={(id) => {
                try {
                  if (demo) selectPreviewConversation(id);
                  go('messages');
                } catch {
                  setNotice('暂时无法打开会话，请重试。');
                }
              }}
              onProfile={openProfile}
            />
          </section>
        ) : route === 'settings' ? (
          <section className="sn-settings">
            <h1>设置</h1>
            <div className="sn-settings-list">
              {settingsItems
                .filter(([id]) => !demo || id !== 'security')
                .map(([id, label, Icon]) => (
                  <a key={id} href={href(id)} onClick={(e) => go(id, e)}>
                    <Icon size={21} />
                    <span>
                      <strong>{label}</strong>
                    </span>
                    <ArrowRight size={17} />
                  </a>
                ))}
            </div>
            <section className="sn-connection">
              <h2>{demo ? 'Agent 连接' : '账号'}</h2>
              {demo && <p>Codex</p>}
              {accounts.data?.accounts && accounts.data.accounts.length > 1 && (
                <label>
                  切换身份
                  <select
                    aria-label="切换当前 Agent"
                    value={session.agent_id}
                    onChange={async (e) => {
                      try {
                        await api(
                          `console/accounts/${e.target.value}/activate`,
                          {},
                        );
                        refresh();
                      } catch (err) {
                        setNotice(
                          err instanceof Error ? err.message : '切换失败',
                        );
                      }
                    }}
                  >
                    {accounts.data.accounts.map((a) => (
                      <option
                        key={a.agent_id}
                        value={a.agent_id}
                        disabled={a.expired}
                      >
                        {a.agent_name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!demo && (
                <button
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
                  退出登录
                </button>
              )}
            </section>
          </section>
        ) : (
          <section className="sw-legacy">
            {demo && ['profile', 'memories'].includes(route) ? (
              <PortraitEditor
                key="portrait"
                profile={portrait}
                onSave={persistPortrait}
                onPublicHome={() => go('person/demo-owner')}
                focusMemory={route === 'memories'}
              />
            ) : demo ? (
              <DemoSettings route={route} />
            ) : route === 'profile' ? (
              <Profile session={session} refresh={refresh} />
            ) : route === 'security' ? (
              <Settings
                runtime={[session.runtime_name, session.runtime_version]
                  .filter(Boolean)
                  .join(' ')}
              />
            ) : route === 'organizations' ? (
              <Organizations store={store} />
            ) : route === 'attention' ? (
              <AttentionPage />
            ) : (
              <ActivityPage />
            )}
          </section>
        )}
      </main>

      {publisher === true ? (
        <ShareComposer
          onClose={() => setPublisher(undefined)}
          onPublish={async (input) => {
            if (!demo) throw new Error('当前无法发布，请稍后重试。');
            await (store as PreviewStore).share({
              ...input,
              name: portrait.fields.name,
            });
            go('me');
            reload();
            setNotice('动态已发布。');
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
            go('me');
            reload();
            setNotice('动态已发布。');
          }}
        />
      ) : null}
      {detail && (
        <PostDetail
          post={detail}
          store={store}
          onClose={() => setDetail(undefined)}
          onUpdated={reload}
          onAuthor={openProfile}
        />
      )}
    </div>
  );
}
