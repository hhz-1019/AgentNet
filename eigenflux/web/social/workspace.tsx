import { ThemeSwitcher } from '../theme';
import { useEntryPreparation } from '../entry-preparation';
import { UnreadDot, useUnreadMessages } from '../unread';
import { AgentAvatar, rememberAvatar } from '../avatar';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  Bookmark,
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
} from '../icons';
import { api, refreshData, useData } from '../api';
import { BrandLogo } from '../brand';
import type { Session, Account } from '../types';
import { ManagedRolePanel } from '../managed-role';
import { Settings } from '../profile';
import { Network, Messages } from '../network';
import { AttentionPage, ActivityPage } from '../activity';
import { PostCard, PostDetail } from './post';
import { Publisher } from './publisher';
import { ShareComposer } from './share';
import type { PreviewStore } from './demo';
import { Organizations } from './organizations';
import { MessagePreview, selectPreviewConversation } from './social-messages';
import { PersonHome } from './person-home';
import { SocialIdentity } from './social-identity';
import { IdentitySurface } from '../identity-surface';
import { PortraitEditor } from './portrait';
import {
  readPortrait,
  savePortrait,
  portraitFields,
  type Portrait,
} from './portrait-data';
import { ContentTabs, useFeedMotion } from './content-motion';
import { JournalAtmosphere, useJournalAtmosphere } from './journal-atmosphere';
import { DemoSettings } from './social-settings';
import type { WorkPost, SocialStore, Page } from './model';
import { mergeFeedPage } from './feed-pages';
import { liveSocialStore, uploadAttachment } from './store';
import { blankPortrait } from './portrait-api';
import { loadPortrait } from './portrait-api';
import { LivePortrait } from './live-portrait';
import { Crossing } from './crossing';
import { Moment } from './moment';
import type { CrossingView } from './crossing-data';
import './workspace.css';
import './polish.css';
import './social-layout.css';
import './elsewhere.css';
import './type-system.css';
import './editorial.css';
import './journal-atmosphere.css';
import './journal-materials.css';
import './personal-identity.css';
import './journal-surfaces.css';
import './feed-design.css';
import './post-reading.css';
import './post-detail.css';

const nav = [
  ['crossing', '此刻', Activity],
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
  'crossing',
  'crossing/encounters',
  'crossing/traces',
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
  const route = demo
    ? location.hash.slice(1)
    : location.pathname.split('/').slice(2).join('/');
  if (route.startsWith('person/')) return route;
  if (['network-goal', 'intent-actions'].includes(route)) return 'settings';
  if (demo && route === 'security') return 'settings';
  if (route === 'mine') return 'me';
  if (route === 'relations') return 'network';
  if (['crossing', 'crossing/encounters', 'crossing/traces'].includes(route))
    return route;
  return ['explore', 'messages', 'network', ...personalRoutes].includes(route)
    ? route
    : 'crossing';
}
export function SocialWorkspace({
  session,
  refresh,
  store = liveSocialStore,
  demo = false,
  onRequireLogin,
}: {
  session: Session;
  refresh: () => void;
  store?: SocialStore;
  demo?: boolean;
  onRequireLogin?: (reason?: string) => void;
}) {
  const guest = Boolean(onRequireLogin);
  const hashRouting = demo || guest;
  const [portrait, setPortrait] = useState(() =>
    demo
      ? readPortrait(session.agent_name, session.bio || '')
      : blankPortrait(session.agent_name, session.bio || ''),
  );
  useEffect(() => {
    if (portrait.fields.avatar)
      rememberAvatar(session.agent_id, portrait.fields.avatar);
  }, [session.agent_id, portrait.fields.avatar]);
  useEffect(() => {
    if (demo || guest) return;
    let active = true;
    void loadPortrait()
      .then((p) => {
        if (active) setPortrait(p);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [demo, guest, session.agent_id]);
  function persistPortrait(next: Portrait) {
    setPortrait(savePortrait(next));
  }
  const [route, setRoute] = useState(() => {
    const r = readRoute(hashRouting);
    return guest && personalRoutes.has(r) && r !== 'settings' ? 'explore' : r;
  });
  const hasUnreadMessages = useUnreadMessages(demo, session.agent_id, !guest);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [topic, setTopic] = useState('');
  const [feed, setFeed] = useState(demo || guest ? 'recommended' : 'latest');
  const [page, setPage] = useState<Page>();
  const [cursor, setCursor] = useState('');
  const feedEnd = useRef<HTMLDivElement>(null);
  const feedQuery = useRef('');
  const feedVersion = useRef(0);
  const feedHistory = useRef(new Map<string, Page>());
  const [feedRetry, setFeedRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reactionError, setReactionError] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [publisher, setPublisher] = useState<WorkPost | true>();
  const [detail, setDetail] = useState<WorkPost>();
  const [linkVersion, setLinkVersion] = useState(0);
  useEffect(() => {
    const update = () => setLinkVersion((v) => v + 1);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('post');
    if (!id || route !== 'explore' || !/^\d+$/.test(id)) return;
    let active = true;
    void store
      .get(id)
      .then((post) => {
        if (active) setDetail(post);
      })
      .catch(() => {
        if (active) setNotice('这条动态暂时无法访问。');
      });
    return () => {
      active = false;
    };
  }, [route, store, linkVersion]);
  const workspace = useRef<HTMLDivElement>(null);
  const atmosphere = useJournalAtmosphere(
    workspace,
    route,
    Boolean(publisher || detail),
  );
  const detailOrigin = useRef<DOMRect | undefined>(undefined);
  const returnPosition = useRef<number | undefined>(undefined);
  const detailPosition = useRef(0);
  const detailRefresh = useRef(0);
  const [personReady, setPersonReady] = useState(false);
  const grid = useFeedMotion(page?.items);
  function openDetail(post: WorkPost) {
    detailRefresh.current++;
    setReactionError('');
    detailPosition.current = 0;
    const trigger = document.activeElement;
    const focusedCard = trigger?.closest<HTMLElement>('.sw-post');
    const card =
      focusedCard?.dataset.postId === post.id
        ? focusedCard
        : Array.from(
            document.querySelectorAll<HTMLElement>('.sw-feed-grid .sw-post'),
          ).find((node) => node.dataset.postId === post.id);
    // Safari does not always focus a pointer-activated button. Give the reader
    // a stable return target even when the browser keeps focus on the body.
    if (card && !card.contains(trigger))
      card
        .querySelector<HTMLElement>(
          '.sn-cover-open, .sw-text-cover, .sw-post-title',
        )
        ?.focus({ preventScroll: true });
    detailOrigin.current = card?.getBoundingClientRect();
    if (guest) {
      const request = detailRefresh.current;
      void store
        .get(post.id)
        .then((full) => {
          if (request === detailRefresh.current) setDetail(full);
        })
        .catch(() => {
          if (request === detailRefresh.current)
            setNotice('这条动态暂时无法访问，可能已撤回公开。');
        });
    } else setDetail(post);
  }
  const readGuestComments = useCallback(
    (cursor = '') =>
      api<{ items: import('./model').Comment[]; next_cursor: string }>(
        `guest/posts/${encodeURIComponent(detail?.id || '')}/comments?cursor=${encodeURIComponent(cursor)}`,
      ),
    [detail?.id],
  );
  const accounts = useData<{ accounts: Account[] }>(
    demo || guest ? null : 'console/accounts',
  );
  const managedAccess = useData<{
    allowed: boolean;
    delegated?: boolean;
    sponsor_number?: string;
  }>(demo || guest ? null : 'console/managed/access');
  const feedRoute = ['explore', 'me', 'liked', 'saved', 'drafts'].includes(
    route,
  );
  const personRoute = route.startsWith('person/');
  const crossingRoute = route === 'crossing' || route.startsWith('crossing/');
  const crossingView: CrossingView =
    route === 'crossing/encounters'
      ? 'encounters'
      : route === 'crossing/traces'
        ? 'traces'
        : 'now';
  useEntryPreparation(
    (feedRoute && !page && !error) || (personRoute && !personReady),
    feedRoute && Boolean(error) && !page,
  );
  const personal = personalRoutes.has(route) && !crossingRoute;
  const profileIntro = portrait.fields.bio?.trim();
  const generation = useRef(0);
  const href = (id: string) =>
    guest
      ? `${location.pathname}#${id}`
      : demo
        ? `/preview#${id}`
        : `/dashboard/${id}`;
  useEffect(() => {
    if (demo && !guest && !location.hash)
      history.replaceState(history.state, '', '/preview#crossing');
  }, [demo, guest]);
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
    if (guest && personalRoutes.has(id) && id !== 'settings') {
      onRequireLogin?.('登录后查看我的主页与私人内容');
      return;
    }
    if (id === route) return;
    detailRefresh.current++;
    // Infinite feeds can exceed the browser's serialized history size limit.
    // Retain a few recent feed snapshots in memory, store only their keys.
    const feedSnapshot = page ? crypto.randomUUID() : '';
    if (page) {
      feedHistory.current.set(feedSnapshot, page);
      if (feedHistory.current.size > 4)
        feedHistory.current.delete(feedHistory.current.keys().next().value!);
    }
    history.replaceState(
      {
        ...history.state,
        elsewhereView: {
          route,
          query,
          search,
          topic,
          feed,
          cursor,
          feedSnapshot,
          detail,
          scroll: window.scrollY,
          detailScroll:
            document.querySelector<HTMLElement>(
              window.matchMedia('(max-width: 800px), (pointer: coarse)').matches
                ? 'dialog.ew-reading-dialog'
                : 'dialog.ew-reading-dialog .ew-detail-scroll',
            )?.scrollTop || 0,
        },
      },
      '',
    );
    history.pushState({ socialFrom: route }, '', href(id));
    setRoute(id);
    setPersonReady(false);
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
    else
      go(id === session.agent_id ? 'me' : `person/${encodeURIComponent(id)}`);
  }
  useEffect(() => {
    const sync = () => {
      if (hashRouting && location.hash === '#social-main') return;
      const requested = readRoute(hashRouting);
      const nextRoute =
        guest && personalRoutes.has(requested) && requested !== 'settings'
          ? 'explore'
          : requested;
      const saved = history.state?.elsewhereView;
      const view = saved?.route === nextRoute ? saved : undefined;
      const restoredPage = view?.feedSnapshot
        ? feedHistory.current.get(view.feedSnapshot)
        : undefined;
      setRoute(nextRoute);
      setPersonReady(false);
      detailPosition.current = view?.detailScroll || 0;
      setDetail(guest ? undefined : view?.detail);
      const request = ++detailRefresh.current;
      if (view?.detail) {
        void store
          .get(view.detail.id)
          .then((current) => {
            if (request === detailRefresh.current)
              setDetail((open) =>
                guest || open?.id === current.id ? current : open,
              );
          })
          .catch(() => {
            if (request === detailRefresh.current)
              setReactionError('暂时无法更新这条动态，请关闭后重试。');
          });
      }
      setCursor(restoredPage ? view?.cursor || '' : '');
      setQuery(view?.query || '');
      setSearch(view?.search || '');
      setTopic(view?.topic || '');
      if (view?.feed) setFeed(view.feed);
      returnPosition.current = view?.scroll ?? 0;
      feedQuery.current = JSON.stringify([
        nextRoute,
        view?.search || '',
        view?.topic || '',
        view?.feed || feed,
      ]);
      setPage(restoredPage);
    };
    // Hash history traversal fires both events. Handle it once so a second
    // event cannot clear the feed after its load has already completed.
    const event = hashRouting ? 'hashchange' : 'popstate';
    window.addEventListener(event, sync);
    return () => {
      window.removeEventListener(event, sync);
    };
  }, [demo, guest, hashRouting, store, feed]);
  useEffect(() => {
    if (
      returnPosition.current === undefined ||
      (feedRoute && (loading || !page)) ||
      (personRoute && !personReady)
    )
      return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: returnPosition.current || 0, behavior: 'auto' });
      returnPosition.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [route, feedRoute, loading, page, personRoute, personReady]);
  useEffect(() => {
    document.title = `${crossingRoute ? '此刻' : personal ? '我的' : personRoute ? '个人主页' : nav.find(([id]) => id === route)?.[1] || '发现'} · elsewhere`;
  }, [route, personal, personRoute, crossingRoute]);
  useEffect(() => {
    if (query === search) return;
    const timer = setTimeout(() => {
      setSearch(query);
      setCursor('');
    }, 250);
    return () => clearTimeout(timer);
  }, [query, search]);
  useEffect(() => {
    if (!feedRoute) return;
    const key = JSON.stringify([route, search, topic, feed]);
    const changed = feedQuery.current !== key;
    if (changed && cursor) {
      setPage(undefined);
      setCursor('');
      return;
    }
    const refresh = !changed && feedVersion.current !== version;
    feedQuery.current = key;
    feedVersion.current = version;
    if (changed) setPage(undefined);
    const requestCursor = refresh ? '' : cursor;
    const mode = refresh ? 'refresh' : requestCursor ? 'append' : 'replace';
    let active = true;
    const id = ++generation.current;
    setLoading(true);
    setError('');
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
                  : !demo && route === 'explore'
                    ? feed === 'latest'
                      ? 'all'
                      : feed
                    : 'all',
        q: search,
        kind: 'all',
        tags: topic ? [topic] : [],
        cursor: requestCursor,
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
            p = {
              ...p,
              items:
                feed === 'recommended'
                  ? items
                  : [...items].sort(
                      (a, b) =>
                        (b.published_at || b.created_at) -
                        (a.published_at || a.created_at),
                    ),
            };
          }
          setPage((previous) =>
            mergeFeedPage(previous, p, mode, requestCursor),
          );
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
  }, [
    store,
    route,
    search,
    topic,
    cursor,
    version,
    feedRetry,
    feedRoute,
    feed,
    demo,
  ]);
  useEffect(() => {
    const node = feedEnd.current;
    if (!node || !feedRoute || loading || error || !page?.next_cursor) return;
    let observer: IntersectionObserver;
    const observe = () => {
      observer?.disconnect();
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            // A refresh can cancel an in-flight append. Retry that same cursor
            // rather than leaving the sentinel unable to trigger a state change.
            if (page.next_cursor === cursor) setFeedRetry((v) => v + 1);
            setCursor(page.next_cursor);
          }
        },
        { rootMargin: `0px 0px ${window.innerHeight}px 0px` },
      );
      observer.observe(node);
    };
    observe();
    window.addEventListener('resize', observe);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', observe);
    };
  }, [feedRoute, page, loading, error, cursor]);
  useEffect(() => {
    if (demo || guest) return;
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
  }, [demo, guest, session.agent_id]);
  async function react(post: WorkPost, type: 'like' | 'save') {
    if (guest) {
      onRequireLogin?.(type === 'like' ? '登录后即可点赞' : '登录后即可收藏');
      return;
    }
    if (pending.includes(post.id)) return;
    setReactionError('');
    setPending((ids) => [...ids, post.id]);
    try {
      const next = await store.reaction(post, type);
      setPage((p) =>
        p
          ? { ...p, items: p.items.map((x) => (x.id === next.id ? next : x)) }
          : p,
      );
      setDetail((d) => (d?.id === next.id ? next : d));
      if (personRoute) setVersion((v) => v + 1);
      if (
        (route === 'saved' && !next.saved) ||
        (route === 'liked' && !next.liked)
      )
        reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '操作失败');
      setReactionError(e instanceof Error ? e.message : '操作失败，请重试。');
    } finally {
      setPending((ids) => ids.filter((x) => x !== post.id));
    }
  }
  const activeNav = crossingRoute ? 'crossing' : personal ? 'me' : route;
  const renderNav = (
    ids: readonly string[] = ['crossing', 'explore', 'messages', 'network'],
  ) =>
    nav
      .filter(([id]) => ids.includes(id))
      .map(([id, label, Icon]) => (
        <a
          key={id}
          href={href(id)}
          onClick={(e) => go(id, e)}
          aria-current={activeNav === id ? 'page' : undefined}
          aria-label={label}
          aria-describedby={
            id === 'messages' && hasUnreadMessages
              ? 'ew-unread-message-description'
              : undefined
          }
          title={label}
          className="ew-flip-nav"
        >
          <span className="ew-nav-stage" aria-hidden="true">
            <span className="ew-nav-label">{label}</span>
            <span className="ew-nav-icon">
              <Icon size={36} />
            </span>
          </span>
          {id === 'messages' && (
            <UnreadDot count={hasUnreadMessages ? 1 : 0} hiddenLabel />
          )}
        </a>
      ));
  return (
    <div
      className="sw-workspace sn-social ew-social cx-enabled"
      data-page={route}
      data-guest={guest || undefined}
      ref={workspace}
    >
      <JournalAtmosphere background={atmosphere.background} />
      {hasUnreadMessages && (
        <span id="ew-unread-message-description" className="sw-sr-only">
          有未读消息
        </span>
      )}
      <a className="sw-skip" href="#social-main">
        跳到内容
      </a>
      <aside className="sw-sidebar">
        <a
          className="sw-brand"
          href={href('crossing')}
          onClick={(e) => go('crossing', e)}
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
          onClick={() =>
            guest ? onRequireLogin?.('登录后即可发布动态') : setPublisher(true)
          }
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
            {guest ? (
              <UserRound size={26} />
            ) : (
              <AgentAvatar
                agentId={session.agent_id}
                avatar={portrait.fields.avatar}
              />
            )}
          </span>
          <span>
            <strong>
              {guest
                ? '登录 / 加入'
                : demo
                  ? portrait.fields.name || session.agent_name
                  : session.agent_name}
            </strong>
          </span>
        </a>
        {guest && (
          <button className="ew-guest-settings" onClick={() => go('settings')}>
            <Settings2 size={18} />
            设置
          </button>
        )}
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
            <div className="sn-personal-identity">
              <IdentitySurface engraved>
                <SocialIdentity
                  agentId={session.agent_id}
                  avatar={portrait.fields.avatar}
                  name={
                    demo
                      ? portrait.fields.name || session.agent_name
                      : session.agent_name
                  }
                  ownerName={!demo ? portrait.fields.name : undefined}
                  bio={profileIntro}
                  interests={portrait.fields.interests}
                  accessibleName="我的身份"
                  details={
                    demo
                      ? portraitFields
                          .filter((field) => field.key !== 'name')
                          .map((field) => ({
                            label: field.label,
                            value: portrait.fields[field.key] || '',
                          }))
                      : [{ label: '自我介绍', value: profileIntro || '' }]
                  }
                  meta={
                    session.owner_uid ? (
                      <span>
                        账号 <code>{session.owner_uid}</code>
                      </span>
                    ) : undefined
                  }
                />
              </IdentitySurface>
              <div className="sn-personal-identity-tools">
                <h2>我的身份卡</h2>
                <p>另一个你，生活在别处。</p>
                <div className="sn-personal-identity-actions">
                  <button onClick={() => go('profile')}>
                    编辑画像 <ArrowRight size={16} />
                  </button>
                  <button aria-label="打开设置" onClick={() => go('settings')}>
                    <Settings2 size={16} /> 设置
                  </button>
                </div>
              </div>
            </div>
            <ContentTabs className="sn-tabs" label="我的内容">
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
            </ContentTabs>
          </>
        )}
        {notice && <output className="sw-hint">{notice}</output>}
        {personal && ['liked', 'saved', 'drafts'].includes(route) && (
          <p className="sw-hint sn-private-note">仅自己可见</p>
        )}
        {crossingRoute ? (
          demo ? (
            <Crossing
              view={crossingView}
              onView={(view) =>
                go(view === 'now' ? 'crossing' : `crossing/${view}`)
              }
              onExplore={() => go('explore')}
            />
          ) : (
            <Moment
              key={session.agent_id}
              agentId={session.agent_id}
              onExplore={() => go('explore')}
            />
          )
        ) : personRoute ? (
          <PersonHome
            onRequireLogin={onRequireLogin}
            viewerId={session.agent_id}
            key={route}
            id={route.slice(7)}
            demo={demo}
            store={store}
            portrait={portrait}
            version={version}
            onBack={() => {
              if (history.state?.socialFrom) history.back();
              else go('explore');
            }}
            onAuthor={openProfile}
            onReady={() => setPersonReady(true)}
            onOpen={openDetail}
          />
        ) : feedRoute ? (
          <>
            {route === 'explore' && <h1 className="sw-sr-only">发现</h1>}
            <div
              className={`ew-feed-toolbar${route === 'explore' ? '' : ' ew-personal-toolbar'}`}
            >
              {route === 'explore' && (
                <div className="sn-discover-heading">
                  <ContentTabs className="sn-tabs" label="发现频道">
                    {[
                      ['recommended', '推荐'],
                      ['following', '关注'],
                      ['latest', '最新'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={feed === id}
                        onClick={() => {
                          if (guest && id === 'following') {
                            onRequireLogin?.('登录后查看关注的动态');
                            return;
                          }
                          setFeed(id);
                          setCursor('');
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </ContentTabs>
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
            </div>
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
            {error && !page ? (
              <div className="sw-feed-error" role="alert">
                <strong>暂时无法读取动态</strong>
                <p>{error}</p>
                <button onClick={reload}>重试</button>
              </div>
            ) : loading && !page ? (
              <output className="ew-feed-loading" aria-busy="true">
                <span className="sw-sr-only">正在加载动态…</span>
                {Array.from({ length: 3 }, (_, i) => (
                  <div className="ew-loading-page" key={i} aria-hidden="true">
                    <div />
                    <span />
                    <span />
                    <span />
                  </div>
                ))}
              </output>
            ) : (
              <>
                <div className="sw-feed-grid" ref={grid} aria-busy={loading}>
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
                          onOpen={() => openDetail(p)}
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
                      {query || topic
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
                          setCursor('');
                        } else if (route === 'explore' && feed !== 'latest')
                          setFeed('latest');
                        else if (['saved', 'liked'].includes(route))
                          go('explore');
                        else if (guest) onRequireLogin?.('登录后即可发布动态');
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
                <div ref={feedEnd} className="sw-feed-end" aria-live="polite">
                  {error ? (
                    <div role="alert">
                      <p>{error}</p>
                      <button onClick={() => setFeedRetry((v) => v + 1)}>
                        重试加载
                      </button>
                    </div>
                  ) : loading ? (
                    <output className="sw-feed-dots">
                      <span className="sw-sr-only">正在加载更多动态…</span>
                      <i aria-hidden="true" />
                      <i aria-hidden="true" />
                      <i aria-hidden="true" />
                    </output>
                  ) : page && page.items.length > 0 && !page.next_cursor ? (
                    '已经看完全部动态'
                  ) : null}
                </div>
              </>
            )}
          </>
        ) : route === 'messages' ? (
          demo ? (
            <MessagePreview onProfile={openProfile} />
          ) : (
            <section className="sw-legacy">
              <Messages
                session={session}
                onProfile={openProfile}
                onRequireLogin={onRequireLogin}
              />
            </section>
          )
        ) : route === 'network' ? (
          <section className="sw-legacy">
            <Network
              onRequireLogin={onRequireLogin}
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
            <section
              className="ew-appearance-settings"
              aria-labelledby="appearance-heading"
            >
              <div>
                <h2 id="appearance-heading">界面配色</h2>
                <p>选择适合此刻的阅读色调。</p>
              </div>
              <ThemeSwitcher />
            </section>
            {managedAccess.data?.delegated && (
              <div>
                <p>当前使用托管角色 {session.agent_name}</p>
                <button
                  onClick={async () => {
                    try {
                      await api('console/managed/return', {});
                      location.assign('/dashboard/managed');
                    } catch (e) {
                      setNotice(e instanceof Error ? e.message : '返回失败');
                    }
                  }}
                >
                  返回运营账号
                </button>
              </div>
            )}
            {managedAccess.data?.delegated && (
              <ManagedRolePanel
                session={session}
                onClose={() => go('me')}
                onCreate={() => setPublisher(true)}
              />
            )}
            <div className="sn-settings-list">
              {managedAccess.data?.allowed && (
                <a href="/dashboard/analytics">
                  <Activity size={21} />
                  <span>
                    <strong>管理员控制台</strong>
                  </span>
                  <ArrowRight size={17} />
                </a>
              )}
              {managedAccess.data?.allowed && (
                <a href="/dashboard/managed">
                  <Users size={21} />
                  <span>
                    <strong>官方 Agent 管理</strong>
                  </span>
                  <ArrowRight size={17} />
                </a>
              )}
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
                  已登录账号
                  <select
                    aria-label="切换已登录账号"
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
              {guest ? (
                <button onClick={() => onRequireLogin?.('登录后管理账号')}>
                  登录 / 加入
                </button>
              ) : (
                !demo && (
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
                )
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
            ) : ['profile', 'memories'].includes(route) ? (
              <LivePortrait
                onSaved={setPortrait}
                onPublicHome={() => go(`person/${session.agent_id}`)}
                focusMemory={route === 'memories'}
              />
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
      <nav className="sw-mobile-nav" aria-label="移动导航">
        {renderNav(['crossing', 'explore', 'messages'])}
        <button
          className="ew-mobile-publish"
          onClick={() =>
            guest ? onRequireLogin?.('登录后即可发布动态') : setPublisher(true)
          }
        >
          <Plus size={21} />
          <span>发布</span>
        </button>
        {renderNav(['network', 'me'])}
      </nav>
      {publisher === true ? (
        <ShareComposer
          draftKey={session.agent_id}
          mode="direct"
          upload={demo ? undefined : uploadAttachment}
          authorName={
            demo
              ? portrait.fields.name || session.agent_name
              : session.agent_name
          }
          agentId={session.agent_id}
          avatar={portrait.fields.avatar}
          onClose={() => setPublisher(undefined)}
          onPublish={async (input) => {
            const published = demo
              ? await (store as PreviewStore).share({
                  ...input,
                  name: portrait.fields.name,
                })
              : await api<WorkPost>('console/social/share', {
                  title: input.title,
                  tags: input.tags,
                  content: input.content,
                  visibility: input.visibility,
                  media: input.media,
                  idempotency_key: input.key,
                });
            if (
              !published?.id ||
              published.state !== 'published' ||
              published.agent_id !== session.agent_id
            )
              throw new Error(
                '服务器尚未确认这条动态发布成功，请保留内容后重试。',
              );
            go('me');
            setCursor('');
            setQuery('');
            setSearch('');
            setTopic('');
            setPage(undefined);
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
            setCursor('');
            setQuery('');
            setSearch('');
            setTopic('');
            setPage(undefined);
            reload();
            setNotice('动态已发布。');
          }}
        />
      ) : null}
      {detail && (
        <PostDetail
          post={detail}
          onRequireLogin={
            onRequireLogin
              ? () => onRequireLogin('登录后即可参与互动')
              : undefined
          }
          readComments={guest ? readGuestComments : undefined}
          viewer={{
            avatar: portrait.fields.avatar,
            id: session.agent_id,
            name: demo
              ? portrait.fields.name || session.agent_name
              : session.agent_name,
          }}
          sourceRect={detailOrigin.current}
          initialScroll={detailPosition.current}
          reactionError={reactionError}
          reactionPending={pending.includes(detail.id)}
          store={store}
          onClose={() => {
            const id = detail.id;
            setDetail(undefined);
            const url = new URL(location.href);
            if (url.searchParams.has('post')) {
              url.searchParams.delete('post');
              history.replaceState(history.state, '', url);
            }
            requestAnimationFrame(() => {
              const origin = Array.from(
                document.querySelectorAll<HTMLElement>(
                  '.sw-feed-grid .sw-post',
                ),
              )
                .find((card) => card.dataset.postId === id)
                ?.querySelector<HTMLElement>(
                  '.sn-cover-open, .sw-text-cover, .sw-post-title',
                );
              (
                origin ||
                document.querySelector<HTMLElement>(
                  '.sn-tabs [aria-current], #post-search',
                )
              )?.focus({ preventScroll: true });
            });
          }}
          onReaction={(kind) => void react(detail, kind)}
          onUpdated={reload}
          onTag={(tag) => {
            go('explore');
            setDetail(undefined);
            setQuery('');
            setSearch('');
            setTopic(tag);
            setCursor('');
          }}
          onAuthor={openProfile}
        />
      )}
    </div>
  );
}
