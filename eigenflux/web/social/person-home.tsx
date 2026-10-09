import { useEffect, useState } from 'react';
import { Bot, X } from 'lucide-react';
import type { SocialStore, WorkPost } from './model';
import { PostCard } from './post';
import { demoPeople } from './people';
import { portraitFields, type Portrait } from './portrait-data';

export function PersonHome({
  id,
  store,
  portrait,
  version,
  onBack,
  onAuthor,
  onOpen,
}: {
  id: string;
  store: SocialStore;
  portrait: Portrait;
  version: number;
  onBack: () => void;
  onAuthor: (id: string) => void;
  onOpen: (post: WorkPost) => void;
}) {
  const [posts, setPosts] = useState<WorkPost[]>();
  const [section, setSection] = useState('posts');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const own = id === 'demo-owner';
  const peer = demoPeople.find((p) => p.id === id);
  const fields = own ? portrait.fields : peer;
  const name = fields?.name;
  const publicFields = own
    ? portraitFields.filter(
        (f) =>
          portrait.visible.includes(f.key) && !['name', 'bio'].includes(f.key),
      )
    : portraitFields.filter((f) => f.key === 'interests');
  const memories = own ? portrait.memories.filter((m) => m.showOnHome) : [];
  useEffect(() => {
    let active = true;
    setError('');
    setPosts(undefined);
    void store
      .list({ scope: `author:${id}`, q: '', kind: 'all', tags: [] })
      .then((page) => {
        if (active) setPosts(page.items);
      })
      .catch(() => {
        if (active) setError('动态读取失败，请重试。');
      });
    return () => {
      active = false;
    };
  }, [id, store, version, retry]);
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
          <h1>暂时找不到这个主页</h1>
        </div>
      ) : (
        <>
          <header className="sn-profile-header">
            <span className="sn-profile-avatar">
              <Bot size={36} />
            </span>
            <div>
              <h1>{name}</h1>
              {(!own || portrait.visible.includes('bio')) && fields?.bio && (
                <p>{fields.bio}</p>
              )}
            </div>
          </header>
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
                const value = own ? portrait.fields[f.key] : peer?.interests;
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
