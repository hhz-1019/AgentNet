import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Heart,
  MessageCircle,
  Bot,
  ExternalLink,
} from 'lucide-react';
import {
  visibilityLabels,
  type WorkPost,
  type SocialStore,
  type Comment,
} from './model';
import { Dialog } from './dialog';
import { time } from '../shared';
const socialKindLabels = {
  result: '动态',
  question: '讨论',
  collab: '一起聊聊',
  tool: '分享',
};
export function PostCard({
  post,
  expanded = false,
  onOpen,
  onReaction,
  onTag,
  onAuthor,
  relevant = [],
}: {
  post: WorkPost;
  expanded?: boolean;
  onOpen?: () => void;
  onReaction?: (kind: 'like' | 'save') => void;
  onTag?: (tag: string) => void;
  onAuthor?: () => void;
  relevant?: string[];
}) {
  const d = post.document,
    [broken, setBroken] = useState<string[]>([]);
  const images = d.media.filter((m) =>
    ['image', 'chart', 'video'].includes(m.kind),
  );
  return (
    <article className={`sw-post${expanded ? ' expanded' : ''}`}>
      {images.length ? (
        <div className="sw-post-media">
          {!expanded && onOpen && images[0]?.kind !== 'video' && (
            <button
              className="sn-cover-open"
              aria-label={`查看动态：${d.title}`}
              onClick={onOpen}
            />
          )}
          {(expanded ? images : images.slice(0, 1)).map((m) =>
            broken.includes(m.url) ? (
              <div className="sw-image-failed" key={m.url}>
                媒体暂时无法加载 · {m.alt}
              </div>
            ) : m.kind === 'video' ? (
              <video
                key={m.url}
                src={m.url}
                controls
                muted
                playsInline
                preload="metadata"
                aria-label={m.alt}
                onError={() => setBroken((b) => [...b, m.url])}
              />
            ) : (
              <img
                key={m.url}
                loading="lazy"
                referrerPolicy="no-referrer"
                src={m.url}
                alt={m.alt}
                onError={() => setBroken((b) => [...b, m.url])}
              />
            ),
          )}
        </div>
      ) : (
        <div className={`sw-text-cover ${d.kind}`}>
          <span>{socialKindLabels[d.kind]}</span>
          <p>{d.title}</p>
          <div className="sw-text-cover-tags">
            {d.tags.slice(0, 2).map((t) => (
              <small key={t}>#{t}</small>
            ))}
          </div>
        </div>
      )}
      <div className="sw-post-content">
        <div className="sw-post-kind">
          <span>{socialKindLabels[d.kind]}</span>
          <small>{visibilityLabels[post.visibility]}</small>
        </div>
        {expanded ? (
          <h2>{d.title}</h2>
        ) : (
          <button className="sw-post-title" onClick={onOpen}>
            {d.title}
          </button>
        )}
        <p className="sw-post-summary">{d.summary}</p>
        {expanded ? (
          <>
            {d.body !== d.title && <p className="sw-post-body">{d.body}</p>}
            <div className="sw-attachments">
              {d.media
                .filter((m) => !['image', 'chart', 'video'].includes(m.kind))
                .map((m) => (
                  <a key={m.url} href={m.url} target="_blank" rel="noreferrer">
                    {m.kind === 'demo' ? 'Demo' : '代码结果'} · {m.alt}
                    <ExternalLink size={14} />
                  </a>
                ))}
            </div>
          </>
        ) : null}
        <div className="sw-tags">
          {d.tags.map((t) =>
            onTag ? (
              <button key={t} onClick={() => onTag(t)}>
                #{t}
              </button>
            ) : (
              <span key={t}>#{t}</span>
            ),
          )}
        </div>
        {relevant.length ? (
          <p className="sw-match-reason">
            与你关注的 {relevant.join('、')} 相关
          </p>
        ) : null}
        <div className="sw-post-author">
          <button
            className="sw-avatar sn-avatar-link"
            disabled={!onAuthor}
            aria-label={`查看${post.author_name}的主页`}
            onClick={onAuthor}
          >
            {d.identity === 'agent' ? (
              <Bot size={18} />
            ) : (
              post.author_name.slice(0, 1)
            )}
          </button>
          <div>
            {onAuthor ? (
              <button onClick={onAuthor}>
                {d.identity === 'project' ? d.project_name : post.author_name}
                <ArrowUpRight size={12} />
              </button>
            ) : (
              <strong>
                {d.identity === 'project' ? d.project_name : post.author_name}
              </strong>
            )}
            <small>{time(post.published_at || post.created_at)}</small>
          </div>
        </div>
        {onReaction ? (
          <footer className="sw-post-actions">
            <button
              aria-label={post.liked ? '取消点赞' : '点赞'}
              aria-pressed={post.liked}
              onClick={() => onReaction('like')}
            >
              <Heart size={17} fill={post.liked ? 'currentColor' : 'none'} />
              {post.likes || '点赞'}
            </button>
            <button aria-label="查看评论" onClick={onOpen}>
              <MessageCircle size={17} />
              {post.comments || '评论'}
            </button>
            <button
              aria-label={post.saved ? '取消收藏' : '收藏'}
              aria-pressed={post.saved}
              onClick={() => onReaction('save')}
            >
              <Bookmark size={17} fill={post.saved ? 'currentColor' : 'none'} />
              {post.saves || '收藏'}
            </button>
          </footer>
        ) : null}
      </div>
    </article>
  );
}
export function PostDetail({
  post,
  store,
  onClose,
  onUpdated,
  onAuthor,
}: {
  post: WorkPost;
  store: SocialStore;
  onClose: () => void;
  onUpdated: () => void;
  onAuthor?: (id: string) => void;
}) {
  const [comments, setComments] = useState<Comment[]>(),
    [content, setContent] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const op = useRef({ key: crypto.randomUUID(), content: '' });
  useEffect(() => {
    let active = true;
    store
      .comments(post.id)
      .then((x) => {
        if (active) setComments(x);
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      });
    return () => {
      active = false;
    };
  }, [store, post.id]);
  return (
    <Dialog title="动态详情" onClose={onClose} wide>
      <PostCard
        post={post}
        expanded
        onAuthor={onAuthor ? () => onAuthor(post.agent_id) : undefined}
      />
      <section className="sw-comments">
        <h3>评论</h3>
        {comments?.map((c) => (
          <article key={c.id}>
            <button
              className="sw-name-link"
              onClick={() => onAuthor?.(c.agent_id)}
            >
              {c.author_name}
            </button>
            <small>{time(c.created_at)}</small>
            <p>{c.content}</p>
          </article>
        ))}
        {comments?.length === 0 ? <p className="sw-hint">暂无评论</p> : null}
        {comments === undefined && !error ? <p>读取评论中…</p> : null}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!content.trim() || busy) return;
            setBusy(true);
            setError('');
            if (op.current.content !== content)
              op.current = { key: crypto.randomUUID(), content };
            try {
              await store.comment(post.id, content, op.current.key);
              setComments(await store.comments(post.id));
              op.current = { key: crypto.randomUUID(), content: '' };
              setContent('');
              onUpdated();
            } catch (err) {
              setError(err instanceof Error ? err.message : '评论失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            你的评论
            <textarea
              rows={3}
              value={content}
              maxLength={2000}
              onChange={(e) => setContent(e.target.value)}
              placeholder="说说你的想法…"
            />
          </label>
          <button className="sw-primary" disabled={busy || !content.trim()}>
            {busy ? '提交中…' : '发布评论'}
          </button>
        </form>
        {error ? (
          <p className="sw-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </Dialog>
  );
}
