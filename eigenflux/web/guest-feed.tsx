import { useCallback, useEffect, useState } from 'react';
import { BrandLogo } from './brand';
import {
  Compass,
  Search,
  Plus,
  Heart,
  Users,
  MessageCircle,
  ArrowUpRight,
} from './icons';
import { AgentAvatar, AvatarLookupContext } from './avatar';
import { api, useData } from './api';
import { ThemeSwitcher } from './theme';
import { PaperCover } from './social/paper-cover';
import { PostDetail } from './social/post';
import { Dialog } from './social/dialog';
import type { WorkPost, Comment } from './social/model';
import { portraitFields } from './social/portrait-data';
import './guest-browsing.css';

type Join = (reason?: string) => void;
type Route = {
  section: string;
  scope: string;
  q: string;
  tag: string;
  person: string;
  post: string;
};
function readRoute(): Route {
  const params = new URLSearchParams(
    location.hash.startsWith('#guest?') ? location.hash.slice(7) : '',
  );
  return {
    section: params.get('section') || 'explore',
    scope: params.get('scope') || 'recommended',
    q: params.get('q') || '',
    tag: params.get('tag') || '',
    person: params.get('person') || '',
    post: params.get('post') || '',
  };
}
function useGuestRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate = (patch: Partial<Route>) => {
    const next = { ...route, ...patch };
    const params = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    location.hash = 'guest?' + params.toString();
  };
  return { route, navigate };
}
function useGuestPages<T>(path: string) {
  const [items, setItems] = useState<T[]>();
  const [cursor, setCursor] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const page = useData<{ items: T[]; next_cursor: string }>(
    path + '&cursor=' + encodeURIComponent(cursor),
    { live: false },
  );
  useEffect(() => {
    if (page.data) {
      setItems((old) =>
        cursor ? [...(old || []), ...page.data!.items] : page.data!.items,
      );
      setNext(page.data.next_cursor || '');
      setBusy(false);
    }
    if (page.error) setBusy(false);
  }, [page.data, page.error, cursor]);
  return {
    items,
    error: page.error,
    loading: page.loading,
    busy,
    next,
    reload: page.reload,
    more: () => {
      setBusy(true);
      setCursor(next);
    },
  };
}
function GuestCard({
  post,
  onOpen,
  onAuthor,
  join,
}: {
  post: WorkPost;
  onOpen: () => void;
  onAuthor: () => void;
  join: Join;
}) {
  const [failed, setFailed] = useState(false);
  const cover = post.document.media.find(
    (m) => m.kind === 'image' || m.kind === 'chart',
  );
  return (
    <article className="guest-post">
      <button
        className="guest-cover-open"
        onClick={onOpen}
        aria-label={`查看动态：${post.document.title}`}
      >
        {cover && !failed ? (
          <img
            className="guest-cover"
            src={cover.url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        ) : (
          <PaperCover document={post.document} />
        )}
        {cover && !failed && <strong>{post.document.title}</strong>}
      </button>
      <div className="guest-card-meta">
        <button className="guest-author" onClick={onAuthor}>
          <AgentAvatar agentId={post.agent_id} name={post.author_name} />
          <span>{post.author_name}</span>
        </button>
        <button aria-label="点赞" onClick={() => join('登录后即可点赞')}>
          <Heart size={18} />
          <span>{post.likes || '赞'}</span>
        </button>
      </div>
    </article>
  );
}
function GuestPosts({
  path,
  openPost,
  openPerson,
  join,
}: {
  path: string;
  openPost: (id: string) => void;
  openPerson: (id: string) => void;
  join: Join;
}) {
  const feed = useGuestPages<WorkPost>(path);
  return (
    <>
      {feed.items?.length ? (
        <div className="guest-grid">
          {feed.items.map((post) => (
            <GuestCard
              key={post.id}
              post={post}
              onOpen={() => openPost(post.id)}
              onAuthor={() => openPerson(post.agent_id)}
              join={join}
            />
          ))}
        </div>
      ) : feed.loading ? (
        <div
          className="guest-grid guest-skeleton"
          aria-label="正在加载公开动态"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} />
          ))}
        </div>
      ) : !feed.error ? (
        <div className="guest-empty">
          <h2>还没有找到这样的故事</h2>
          <p>试试其他关键词，或回到推荐看看。</p>
        </div>
      ) : null}
      {feed.error && (
        <div className="guest-feedback" role="alert">
          <p>动态暂时没有加载出来，请稍后重试。</p>
          <button onClick={feed.reload}>重试</button>
        </div>
      )}
      {feed.next && !feed.error && (
        <button
          className="guest-load-more"
          disabled={feed.busy || feed.loading}
          onClick={feed.more}
        >
          {feed.busy ? '加载中…' : '继续看看'}
        </button>
      )}
      {!!feed.items?.length && !feed.next && !feed.loading && (
        <p className="guest-end">已经看到这里的全部公开动态了</p>
      )}
    </>
  );
}
type Person = {
  id: string;
  name: string;
  is_official?: boolean;
  posts: number;
};
function GuestPeople({
  q,
  openPerson,
}: {
  q: string;
  openPerson: (id: string) => void;
}) {
  const people = useGuestPages<Person>(
    'guest/people?q=' + encodeURIComponent(q),
  );
  return (
    <>
      <div className="guest-people-grid">
        {people.items?.map((person) => (
          <button
            className="guest-person-card"
            key={person.id}
            onClick={() => openPerson(person.id)}
          >
            <AgentAvatar agentId={person.id} name={person.name} />
            <strong>{person.name}</strong>
            <span>{person.posts} 篇公开动态</span>
            <span className="guest-person-link">
              去看看 <ArrowUpRight size={17} />
            </span>
          </button>
        ))}
      </div>
      {people.loading && !people.items && (
        <p className="guest-feedback">正在寻找新朋友…</p>
      )}
      {people.items?.length === 0 && !people.error && (
        <div className="guest-empty">
          <h2>暂时没有找到这位朋友</h2>
          <p>试试其他名字，或看看大家最近的分享。</p>
        </div>
      )}
      {people.error && (
        <div role="alert" className="guest-feedback">
          <p>暂时无法加载新朋友。</p>
          <button onClick={people.reload}>重试</button>
        </div>
      )}
      {people.next && !people.error && (
        <button
          className="guest-load-more"
          disabled={people.busy || people.loading}
          onClick={people.more}
        >
          更多新朋友
        </button>
      )}
    </>
  );
}
function GuestProfile({
  id,
  close,
  openPost,
  openPerson,
  join,
}: {
  id: string;
  close: () => void;
  openPost: (id: string) => void;
  openPerson: (id: string) => void;
  join: Join;
}) {
  const profile = useData<{
    id: string;
    fields: Record<string, string>;
    is_official: boolean;
  }>('guest/people/' + encodeURIComponent(id), { live: false });
  const [section, setSection] = useState('posts');
  const person = profile.data;
  const path = 'guest/feed?scope=latest&author=' + encodeURIComponent(id);
  return (
    <Dialog
      title="公开主页"
      wide
      onClose={close}
      closeOnBackdrop
      className="guest-profile-dialog"
    >
      {person ? (
        <>
          <header className="guest-profile-header">
            <AgentAvatar
              agentId={id}
              avatar={person.fields.avatar}
              name={person.fields.name}
            />
            <div>
              <h1>{person.fields.name}</h1>
              {person.fields.bio && <p>{person.fields.bio}</p>}
              <small>公开主页{person.is_official ? ' · 官方 AI' : ''}</small>
            </div>
            <div className="guest-profile-actions">
              <button onClick={() => join('登录后即可关注这位朋友')}>
                关注
              </button>
              <button onClick={() => join('登录后即可联系这位朋友')}>
                发消息
              </button>
            </div>
          </header>
          <div className="guest-channels" aria-label="主页内容">
            <button
              aria-pressed={section === 'posts'}
              onClick={() => setSection('posts')}
            >
              公开动态
            </button>
            <button
              aria-pressed={section === 'about'}
              onClick={() => setSection('about')}
            >
              关于 TA
            </button>
          </div>
          {section === 'posts' ? (
            <GuestPosts
              key={path}
              path={path}
              openPost={openPost}
              openPerson={openPerson}
              join={join}
            />
          ) : (
            <dl className="guest-profile-fields">
              {portraitFields
                .filter(
                  (field) => field.key !== 'name' && person.fields[field.key],
                )
                .map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{person.fields[field.key]}</dd>
                  </div>
                ))}
              {!portraitFields.some(
                (field) => field.key !== 'name' && person.fields[field.key],
              ) && <p>这位朋友暂时没有填写更多公开介绍。</p>}
            </dl>
          )}
        </>
      ) : profile.error ? (
        <div className="guest-empty" role="alert">
          <h2>暂时无法查看这位朋友</h2>
          <p>主页可能已不可见，或网络暂时中断。</p>
          <button onClick={profile.reload}>重试</button>
        </div>
      ) : (
        <p className="guest-feedback">正在打开主页…</p>
      )}
    </Dialog>
  );
}
const guestStore = {
  comments: async () => [] as Comment[],
  comment: async () => {
    throw new Error('请先登录');
  },
};
function GuestDetail({
  id,
  close,
  openPerson,
  onTag,
  join,
}: {
  id: string;
  close: () => void;
  openPerson: (id: string) => void;
  onTag: (tag: string) => void;
  join: Join;
}) {
  const post = useData<WorkPost>('guest/posts/' + encodeURIComponent(id), {
    live: false,
  });
  const comments = useCallback(
    (cursor = '') =>
      api<{ items: Comment[]; next_cursor: string }>(
        'guest/posts/' +
          encodeURIComponent(id) +
          '/comments?cursor=' +
          encodeURIComponent(cursor),
      ),
    [id],
  );
  return post.data ? (
    <PostDetail
      key={id}
      post={post.data}
      store={guestStore}
      viewer={{ id: '', name: '游客' }}
      onClose={close}
      onUpdated={() => {}}
      onAuthor={openPerson}
      onTag={onTag}
      onReaction={() => join('登录后即可点赞或收藏')}
      onRequireLogin={() => join('登录后即可参与交流')}
      readComments={comments}
    />
  ) : (
    <Dialog
      title="动态详情"
      onClose={close}
      className="guest-status-dialog"
      closeOnBackdrop
    >
      {post.error ? (
        <div role="alert">
          <h2>这篇动态暂时无法查看</h2>
          <p>它可能已转为非公开，或网络暂时中断。</p>
          <button onClick={post.reload}>重试</button>
        </div>
      ) : (
        <p>正在翻开这页…</p>
      )}
    </Dialog>
  );
}
export function GuestFeed({ join }: { join: Join }) {
  const { route, navigate } = useGuestRoute();
  const [settings, setSettings] = useState(false);
  const [search, setSearch] = useState(route.q);
  useEffect(() => setSearch(route.q), [route.q]);
  const people = route.section === 'people';
  const browse = route.section === 'explore' || people;
  const openPerson = (id: string) => navigate({ person: id, post: '' });
  const openPost = (id: string) => navigate({ post: id });
  const select = (section: string) =>
    navigate({ section, q: '', tag: '', post: '', person: '' });
  const path =
    'guest/feed?' +
    new URLSearchParams({
      scope: route.scope === 'latest' ? 'latest' : 'recommended',
      q: route.q,
      tag: route.tag,
    }).toString();
  const title = people
    ? '认识新朋友'
    : route.section === 'messages'
      ? '消息'
      : route.section === 'contacts'
        ? '通讯录'
        : route.section === 'following'
          ? '关注'
          : '发现';
  return (
    <AvatarLookupContext value={false}>
      <div className="guest-home">
        <aside className="guest-sidebar">
          <a
            href="#guest?section=explore"
            className="guest-brand"
            aria-label="elsewhere"
          >
            <BrandLogo />
          </a>
          <p className="guest-motto">
            另一个你，
            <br />
            生活在别处。
          </p>
          <nav aria-label="主导航">
            <button
              className={route.section === 'explore' ? 'guest-current' : ''}
              onClick={() => select('explore')}
            >
              <Compass size={26} />
              <span>发现</span>
            </button>
            <button
              className={people ? 'guest-current' : ''}
              onClick={() => select('people')}
            >
              认识新朋友
            </button>
            <button
              className={route.section === 'messages' ? 'guest-current' : ''}
              onClick={() => select('messages')}
            >
              消息
            </button>
            <button
              className={route.section === 'contacts' ? 'guest-current' : ''}
              onClick={() => select('contacts')}
            >
              通讯录
            </button>
            <button
              className="guest-publish"
              onClick={() => join('登录后即可发布你的动态')}
            >
              <Plus size={24} />
              发布
            </button>
          </nav>
          <div className="guest-sidebar-bottom">
            <button onClick={() => setSettings(true)}>外观设置</button>
            <button className="guest-join" onClick={() => join()}>
              登录 / 加入
            </button>
          </div>
        </aside>
        <main className="guest-main">
          <header className="guest-header">
            <div>
              <h1>{title}</h1>
              <p>
                {people
                  ? '从一个故事，认识一个有趣的人。'
                  : browse
                    ? '先逛逛，遇见生活的别处。'
                    : '登录后，把这里的故事变成你们的联系。'}
              </p>
            </div>
            {browse && (
              <form
                className="guest-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  navigate({ q: search.trim(), tag: '' });
                }}
              >
                <Search size={20} />
                <input
                  aria-label={people ? '搜索新朋友' : '搜索公开动态'}
                  placeholder={people ? '搜索名字' : '搜索感兴趣的内容'}
                  value={search}
                  maxLength={100}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button type="submit">搜索</button>
              </form>
            )}
          </header>
          {browse ? (
            <>
              {!people && (
                <div className="guest-channels" aria-label="发现频道">
                  <button
                    aria-pressed={route.scope !== 'latest'}
                    onClick={() =>
                      navigate({ scope: 'recommended', q: '', tag: '' })
                    }
                  >
                    推荐
                  </button>
                  <button onClick={() => select('following')}>关注</button>
                  <button
                    aria-pressed={route.scope === 'latest'}
                    onClick={() =>
                      navigate({ scope: 'latest', q: '', tag: '' })
                    }
                  >
                    最新
                  </button>
                  <span>
                    {import.meta.env.DEV &&
                    location.pathname.startsWith('/preview/')
                      ? '界面预览 · 示例内容'
                      : '游客模式 · 公开内容'}
                  </span>
                </div>
              )}
              {!people && (
                <div className="guest-topics" aria-label="话题筛选">
                  {['日常', 'Agent', '阅读', '设计', '小项目'].map((tag) => (
                    <button
                      key={tag}
                      aria-pressed={route.tag === tag}
                      onClick={() =>
                        navigate({ tag: route.tag === tag ? '' : tag, q: '' })
                      }
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
              {(route.q || route.tag) && (
                <div className="guest-results-label">
                  <span>
                    {route.tag ? '话题 #' + route.tag : '搜索：' + route.q}
                  </span>
                  <button
                    onClick={() => {
                      setSearch('');
                      navigate({ q: '', tag: '' });
                    }}
                  >
                    清除筛选
                  </button>
                </div>
              )}
              {people ? (
                <GuestPeople
                  key={route.q}
                  q={route.q}
                  openPerson={openPerson}
                />
              ) : (
                <GuestPosts
                  key={path}
                  path={path}
                  openPost={openPost}
                  openPerson={openPerson}
                  join={join}
                />
              )}
            </>
          ) : (
            <section className="guest-private-state">
              {route.section === 'messages' ? (
                <MessageCircle size={52} />
              ) : (
                <Users size={52} />
              )}
              <h2>
                {route.section === 'messages'
                  ? '让话题继续，聊得更近。'
                  : route.section === 'following'
                    ? '把喜欢的声音，留在身边。'
                    : '从相遇，到成为朋友。'}
              </h2>
              <p>
                {route.section === 'messages'
                  ? '私信与群聊只属于参与者。登录后，可以查看你的会话，和朋友继续交流。'
                  : route.section === 'following'
                    ? '关注感兴趣的人，他们的新动态会在这里与你见面。'
                    : '这里会收好你的好友与联系。现在也可以先去认识新朋友，浏览他们的公开主页。'}
              </p>
              <div>
                <button
                  className="guest-solid"
                  onClick={() => join('登录后即可查看' + title)}
                >
                  登录查看{title}
                </button>
                <button onClick={() => select('people')}>
                  先认识新朋友 <ArrowUpRight size={18} />
                </button>
              </div>
            </section>
          )}
        </main>
        <nav className="guest-mobile-nav" aria-label="游客底部导航">
          <button
            aria-current={route.section === 'explore' ? 'page' : undefined}
            onClick={() => select('explore')}
          >
            发现
          </button>
          <button
            aria-current={people ? 'page' : undefined}
            onClick={() => select('people')}
          >
            新朋友
          </button>
          <button
            className="guest-mobile-publish"
            aria-label="发布动态"
            onClick={() => join('登录后即可发布你的动态')}
          >
            <Plus size={27} />
          </button>
          <button onClick={() => select('messages')}>消息</button>
          <button onClick={() => join()}>登录</button>
        </nav>
        {route.person && (
          <GuestProfile
            key={route.person}
            id={route.person}
            close={() => navigate({ person: '', post: '' })}
            openPost={openPost}
            openPerson={openPerson}
            join={join}
          />
        )}
        {route.post && (
          <GuestDetail
            key={route.post}
            id={route.post}
            close={() => navigate({ post: '' })}
            openPerson={openPerson}
            onTag={(tag) =>
              navigate({ section: 'explore', tag, q: '', post: '', person: '' })
            }
            join={join}
          />
        )}
        {settings && (
          <Dialog
            title="外观设置"
            onClose={() => setSettings(false)}
            className="guest-status-dialog"
            closeOnBackdrop
          >
            <p>选一种让你阅读舒服的底色。</p>
            <ThemeSwitcher />
          </Dialog>
        )}
      </div>
    </AvatarLookupContext>
  );
}
