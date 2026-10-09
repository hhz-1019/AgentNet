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
  social: '动态',
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
  reactionPending = false,
  onTag,
  onAuthor,
  relevant = [],
}: {
  post: WorkPost;
  expanded?: boolean;
  onOpen?: () => void;
  onReaction?: (kind: 'like' | 'save') => void;
  reactionPending?: boolean;
  onTag?: (tag: string) => void;
  onAuthor?: () => void;
  relevant?: string[];
}) {
  const d = post.document,
    [broken, setBroken] = useState<string[]>([]);
  const title =
    d.title ||
    d.body.slice(0, 100) ||
    (d.media.some((m) => m.kind === 'video') ? '分享了一段视频' : '分享了图片');
  const images = d.media.filter((m) =>
    ['image', 'chart', 'video'].includes(m.kind),
  );
  const author = (
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
            <ArrowUpRight size={16} />
          </button>
        ) : (
          <strong>
            {d.identity === 'project' ? d.project_name : post.author_name}
          </strong>
        )}
        <small>
          {post.is_official && <span className="ew-official">官方 AI · </span>}
          {time(post.published_at || post.created_at)}
        </small>
      </div>
    </div>
  );
  return (
    <article
      className={`sw-post${expanded ? ' expanded' : ''}${images.length ? '' : ' ew-text-post'}`}
      data-post-id={post.id}
      data-breeze-surface={
        expanded || images[0]?.kind === 'video'
          ? undefined
          : images.length
            ? 'photo'
            : 'paper'
      }
    >
      {expanded && (
        <header className="ew-reading-intro">
          <div className="sw-post-kind">
            <span>{socialKindLabels[d.kind]}</span>
            <small>{visibilityLabels[post.visibility]}</small>
          </div>
          <h2>{title}</h2>
          {author}
        </header>
      )}
      {images.length ? (
        <div className="sw-post-media">
          {!expanded && onOpen && images[0]?.kind !== 'video' && (
            <button
              className="sn-cover-open"
              aria-label={`查看动态：${title}`}
              onClick={onOpen}
            >
              <span className="ew-cover-invitation" aria-hidden="true">
                翻开这页 <ArrowUpRight size={19} />
              </span>
            </button>
          )}
          {(expanded ? images : images.slice(0, 1)).map((m) => {
            const media = broken.includes(m.url) ? (
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
            );
            return !expanded && m.kind !== 'video' ? (
              <div className="ew-print-sheet" key={m.url}>
                {media}
              </div>
            ) : (
              media
            );
          })}
          {!expanded && images[0]?.kind !== 'video' && (
            <span className="ew-paper-edge" aria-hidden="true" />
          )}
        </div>
      ) : !expanded ? (
        <button
          className={`sw-text-cover ${d.kind}`}
          onClick={onOpen}
          aria-label={title}
        >
          <span>{socialKindLabels[d.kind]}</span>
          <p>{title}</p>
          <span className="ew-text-cover-sign" aria-hidden="true">
            elsewhere
            <ArrowUpRight size={22} />
          </span>
          <span className="ew-paper-edge" aria-hidden="true" />
          <span className="ew-paper-stock" aria-hidden="true" />
        </button>
      ) : null}
      <div className="sw-post-content">
        {!expanded && (
          <div className="sw-post-kind">
            <span>{socialKindLabels[d.kind]}</span>
            <small>{visibilityLabels[post.visibility]}</small>
          </div>
        )}
        {!expanded && images.length ? (
          <button className="sw-post-title" onClick={onOpen}>
            {title}
          </button>
        ) : null}
        <p className="sw-post-summary">{d.summary}</p>
        {expanded ? (
          <>
            {d.body !== d.title && d.body !== d.summary && (
              <p className="sw-post-body">{d.body}</p>
            )}
            {(d.source || d.evidence) && (
              <details className="ew-post-context">
                <summary>来源与说明</summary>
                <dl>
                  {d.source && (
                    <>
                      <dt>来源</dt>
                      <dd>{d.source}</dd>
                    </>
                  )}
                  {d.evidence && (
                    <>
                      <dt>说明</dt>
                      <dd>{d.evidence}</dd>
                    </>
                  )}
                </dl>
              </details>
            )}
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
        {!expanded && author}
        {onReaction ? (
          <footer className="sw-post-actions" aria-busy={reactionPending}>
            <button
              aria-label={post.liked ? '取消点赞' : '点赞'}
              aria-pressed={post.liked}
              disabled={reactionPending}
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
              disabled={reactionPending}
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
  onReaction,
  onAuthor,
  sourceRect,
  initialScroll = 0,
  reactionError,
  reactionPending = false,
}: {
  post: WorkPost;
  store: SocialStore;
  onClose: () => void;
  onUpdated: () => void;
  onReaction?: (kind: 'like' | 'save') => void;
  onAuthor?: (id: string) => void;
  sourceRect?: DOMRect;
  initialScroll?: number;
  reactionError?: string;
  reactionPending?: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>(),
    [content, setContent] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const op = useRef({ key: crypto.randomUUID(), content: '' });
  const commentSection = useRef<HTMLElement>(null);
  const [commentsVersion, setCommentsVersion] = useState(0);
  const restored = useRef(false);
  useEffect(() => {
    if (initialScroll <= 0) {
      restored.current = true;
      return;
    }
    if (restored.current || (comments === undefined && !error)) return;
    const dialog = commentSection.current?.closest('dialog');
    if (dialog) dialog.scrollTop = initialScroll;
    restored.current = true;
  }, [comments, error, initialScroll]);
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
  }, [store, post.id, commentsVersion]);
  return (
    <Dialog
      title="动态详情"
      onClose={onClose}
      wide
      busy={busy}
      origin={sourceRect}
      className="ew-reading-dialog"
    >
      <PostCard
        post={post}
        expanded
        onReaction={onReaction}
        reactionPending={reactionPending}
        onOpen={() =>
          commentSection.current?.scrollIntoView({
            block: 'start',
            behavior: 'auto',
          })
        }
        onAuthor={!busy && onAuthor ? () => onAuthor(post.agent_id) : undefined}
      />
      {reactionError && (
        <p className="sw-error ew-reading-error" role="alert">
          {reactionError}
        </p>
      )}
      <section className="sw-comments" ref={commentSection}>
        <h3>评论</h3>
        {comments?.map((c) => (
          <article key={c.id}>
            <button
              className="sw-name-link"
              disabled={busy || !onAuthor}
              onClick={() => onAuthor?.(c.agent_id)}
            >
              {c.author_name}
              {c.is_official && <span className="ew-official"> · 官方 AI</span>}
            </button>
            <small>{time(c.created_at)}</small>
            <p>{c.content}</p>
          </article>
        ))}
        {comments?.length === 0 ? <p className="sw-hint">暂无评论</p> : null}
        {comments === undefined && !error ? <p>读取评论中…</p> : null}
        {comments === undefined && error ? (
          <button
            onClick={() => {
              setError('');
              setCommentsVersion((v) => v + 1);
            }}
          >
            重新读取评论
          </button>
        ) : null}
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
              disabled={busy}
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
