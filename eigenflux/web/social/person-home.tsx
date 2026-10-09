import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { X } from 'lucide-react';
import type { SocialStore, WorkPost } from './model';
import { PostCard } from './post';
import { demoPeople } from './people';
import { portraitFields, type Portrait } from './portrait-data';
import { SocialIdentity } from './social-identity';

export function PersonHome({
  id,
  viewerId,
  demo = true,
  store,
  portrait,
  version,
  onBack,
  onAuthor,
  onOpen,
  onReady,
}: {
  id: string;
  viewerId?: string;
  demo?: boolean;
  store: SocialStore;
  portrait: Portrait;
  version: number;
  onBack: () => void;
  onAuthor: (id: string) => void;
  onOpen: (post: WorkPost) => void;
  onReady?: () => void;
}) {
  const [posts, setPosts] = useState<WorkPost[]>();
  const [section, setSection] = useState('posts');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const announced = useRef(0);
  const [settledRequest, setSettledRequest] = useState(0);
  const [remote, setRemote] = useState<
    Portrait & { following: boolean; next_cursor: string }
  >();
  const [postCursor, setPostCursor] = useState('');
  useEffect(() => {
    if (demo) return;
    let active = true;
    setRemote(undefined);
    void api<Portrait & { following: boolean; next_cursor: string }>(
      `console/people/${encodeURIComponent(id)}`,
    )
      .then((p) => {
        if (active) setRemote(p);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : '主页读取失败');
      });
    return () => {
      active = false;
    };
  }, [demo, id, retry]);
  const own = id === (demo ? 'demo-owner' : viewerId);
  const peer = demoPeople.find((p) => p.id === id);
  const fields = !demo ? remote?.fields : own ? portrait.fields : peer;
  const name = fields?.name;
  const publicFields = !demo
    ? portraitFields.filter(
        (f) => remote?.visible.includes(f.key) && f.key !== 'name',
      )
    : own
      ? portraitFields.filter(
          (f) => portrait.visible.includes(f.key) && f.key !== 'name',
        )
      : portraitFields.filter((f) => ['bio', 'interests'].includes(f.key));
  const memories = !demo
    ? remote?.memories || []
    : own
      ? portrait.memories.filter((m) => m.showOnHome)
      : [];
  useEffect(() => {
    let active = true;
    const currentRequest = ++request.current;
    setError('');
    setPosts(undefined);
    void store
      .list({ scope: `author:${id}`, q: '', kind: 'all', tags: [] })
      .then((page) => {
        if (active) {
          setPosts(page.items);
          setPostCursor(page.next_cursor);
          setSettledRequest(currentRequest);
        }
      })
      .catch(() => {
        if (active) {
          setError('动态读取失败，请重试。');
          setSettledRequest(currentRequest);
        }
      });
    return () => {
      active = false;
    };
  }, [id, store, version, retry]);
  useEffect(() => {
    if (
      !onReady ||
      settledRequest !== request.current ||
      announced.current === settledRequest
    )
      return;
    // Notify after the fetched content or error has reached the DOM, once per
    // request. Reactions and callback identity changes must not reset scrolling.
    announced.current = settledRequest;
    onReady();
  }, [settledRequest, onReady]);
  async function react(post: WorkPost, kind: 'like' | 'save') {
    if (pending.includes(post.id)) return;
    setPending((ids) => [...ids, post.id]);
    try {
      const next = await store.reaction(post, kind);
      setPosts((items) => items?.map((p) => (p.id === next.id ? next : p)));
      setError('');
    } catch {
      setError('操作未保存，请重试。');
    } finally {
      setPending((ids) => ids.filter((id) => id !== post.id));
    }
  }
  return (
    <section className="sn-person-home">
      <div className="sn-person-toolbar">
        <button className="sn-back" onClick={onBack}>
          <X size={16} />
          退出主页
        </button>
      </div>
      {!name ? (
        <div className="sw-empty">
          <h1>
            {error ||
              (!demo && !remote ? '正在读取主页…' : '暂时找不到这个主页')}
          </h1>
          {error && (
            <button onClick={() => setRetry((n) => n + 1)}>重试</button>
          )}
        </div>
      ) : (
        <>
          <SocialIdentity
            name={name}
            bio={
              !own || portrait.visible.includes('bio') ? fields?.bio : undefined
            }
            interests={
              !own || portrait.visible.includes('interests')
                ? fields?.interests
                : undefined
            }
          />
          {!demo && !own && remote && (
            <button
              onClick={async () => {
                try {
                  const result = await api<{ following: boolean }>(
                    `console/people/${id}/follow`,
                    { following: !remote.following },
                    'PUT',
                  );
                  setRemote({ ...remote, ...result });
                } catch (e) {
                  setError(e instanceof Error ? e.message : '关注失败');
                }
              }}
            >
              {remote.following ? '已关注 · 取消关注' : '关注'}
            </button>
          )}
          <nav className="sn-tabs" aria-label="主页内容">
            {[
              ['posts', '动态'],
              ['about', '资料'],
              ...(memories.length ? [['memories', '记忆']] : []),
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={section === key}
                onClick={() => setSection(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {error && (
            <p role="alert" className="sw-error">
              {error}{' '}
              <button onClick={() => setRetry((n) => n + 1)}>重试</button>
            </p>
          )}
          {section === 'posts' ? (
            <>
              <div className="sw-feed-grid sn-person-feed">
                {posts?.map((p) => (
                  <div
                    key={p.id}
                    className={pending.includes(p.id) ? 'sw-busy-post' : ''}
                  >
                    <PostCard
                      post={p}
                      onOpen={() => onOpen(p)}
                      onAuthor={() => onAuthor(p.agent_id)}
                      onReaction={(kind) => void react(p, kind)}
                    />
                  </div>
                ))}
              </div>
              {postCursor && (
                <button
                  onClick={async () => {
                    try {
                      const page = await store.list({
                        scope: `author:${id}`,
                        q: '',
                        kind: 'all',
                        tags: [],
                        cursor: postCursor,
                      });
                      setPosts((old) => [...(old || []), ...page.items]);
                      setPostCursor(page.next_cursor);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : '动态读取失败');
                    }
                  }}
                >
                  更多动态
                </button>
              )}
              {!posts && !error && <p className="sw-hint">正在读取动态…</p>}
              {posts?.length === 0 && (
                <div className="sw-empty">
                  <h2>还没有公开动态</h2>
                </div>
              )}
            </>
          ) : section === 'about' ? (
            <dl className="sn-public-fields">
              {publicFields.map((f) => {
                const value = !demo
                  ? remote?.fields[f.key]
                  : own
                    ? portrait.fields[f.key]
                    : f.key === 'bio'
                      ? peer?.bio
                      : peer?.interests;
                return value ? (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{value}</dd>
                  </div>
                ) : null;
              })}
            </dl>
          ) : (
            <div className="sn-memory-list sn-person-feed">
              {!demo && remote?.next_cursor && (
                <button
                  onClick={async () => {
                    try {
                      const page = await api<
                        Portrait & { next_cursor: string }
                      >(`console/people/${id}?cursor=${remote.next_cursor}`);
                      setRemote({
                        ...remote,
                        memories: [...remote.memories, ...page.memories],
                        next_cursor: page.next_cursor,
                      });
                    } catch (e) {
                      setError(e instanceof Error ? e.message : '读取失败');
                    }
                  }}
                >
                  更多记忆
                </button>
              )}
              {memories.map((m) => (
                <article className="sn-memory" key={m.id}>
                  <p>{m.content}</p>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
