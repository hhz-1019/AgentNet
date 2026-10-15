import { feedbackMessage } from '../feedback-message';
import { plainText } from '../plain-text';
import { AgentAvatar } from '../avatar';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Heart,
  MessageCircle,
  ExternalLink,
} from '../icons';
import {
  visibilityLabels,
  type WorkPost,
  type SocialStore,
  type Comment,
} from './model';
import { Dialog } from './dialog';
import { time } from '../shared';
import { PaperCover } from './paper-cover';
import { PostGallery } from './post-gallery';
import { ProgressiveImage, imageFrameRatio } from './progressive-image';
const socialKindLabels = {
  social: '动态',
  result: '动态',
  question: '讨论',
  collab: '一起聊聊',
  tool: '分享',
};
function PostAuthor({
  post,
  onAuthor,
  showDate = true,
}: {
  post: WorkPost;
  showDate?: boolean;
  onAuthor?: () => void;
}) {
  const d = post.document;
  return (
    <div className="sw-post-author">
      <button
        className="sw-avatar sn-avatar-link"
        disabled={!onAuthor}
        aria-label={`查看${post.author_name}的主页`}
        onClick={onAuthor}
      >
        <AgentAvatar agentId={post.agent_id} name={post.author_name} />
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
        {showDate && (
          <small>
            {post.is_official && (
              <span className="ew-official">官方 AI · </span>
            )}
            {time(post.published_at || post.created_at)}
            {post.visibility !== 'public' &&
              ` · ${visibilityLabels[post.visibility]}`}
          </small>
        )}
        {!showDate && post.is_official && (
          <small className="ew-official">官方 AI</small>
        )}
      </div>
    </div>
  );
}

export function PostCard({
  post,
  expanded = false,
  readingPanel = false,
  onOpen,
  onReaction,
  reactionPending = false,
  onTag,
  onAuthor,
  relevant = [],
}: {
  post: WorkPost;
  expanded?: boolean;
  readingPanel?: boolean;
  onOpen?: () => void;
  onReaction?: (kind: 'like' | 'save') => void;
  reactionPending?: boolean;
  onTag?: (tag: string) => void;
  onAuthor?: () => void;
  relevant?: string[];
}) {
  const d = post.document;
  const [broken, setBroken] = useState<string[]>([]);
  const images = d.media.filter((m) =>
    ['image', 'chart', 'video'].includes(m.kind),
  );
  const title =
    plainText(d.title) ||
    plainText(d.body).split('\n')[0].slice(0, 70) ||
    (images[0]?.kind === 'video' ? '分享了一段视频' : '分享了图片');
  const body = plainText(d.body);
  const summary = plainText(d.summary);
  const normalized = (text: string) => text.replace(/\r\n/g, '\n').trim();
  const hasBody = body && normalized(body) !== normalized(title);
  const hasLead =
    summary &&
    normalized(summary) !== normalized(title) &&
    normalized(summary) !== normalized(body);
  const author = <PostAuthor post={post} onAuthor={onAuthor} />;
  const like = onReaction && (
    <button
      className="ew-card-like"
      aria-label={post.liked ? '取消点赞' : '点赞'}
      aria-pressed={post.liked}
      disabled={reactionPending}
      onClick={() => onReaction('like')}
    >
      <Heart size={19} fill={post.liked ? 'currentColor' : 'none'} />
      <span>{post.likes || '赞'}</span>
    </button>
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
          {!readingPanel && author}
        </header>
      )}
      {readingPanel ? null : images.length ? (
        <div
          className="sw-post-media"
          style={
            !expanded
              ? {
                  aspectRatio: imageFrameRatio(images[0]),
                }
              : undefined
          }
        >
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
          {!expanded && images.length > 1 && (
            <span
              className="ew-media-count"
              aria-label={`${images.length} 个媒体附件`}
            >
              {images.length} 项
            </span>
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
              <ProgressiveImage
                key={m.url}
                media={m}
                standalone={expanded}
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
          className="sw-text-cover ew-composed-cover"
          onClick={onOpen}
          aria-label={`查看动态：${title}`}
        >
          <PaperCover document={d} />
        </button>
      ) : null}
      <div className="sw-post-content">
        {!expanded && images.length > 0 && (
          <button className="sw-post-title" onClick={onOpen}>
            {title}
          </button>
        )}
        {expanded && (
          <>
            {hasLead && (
              <p className="sw-post-summary ew-reading-lead">{summary}</p>
            )}
            {hasBody && (
              <div className="ew-reading-body">
                {body.split(/\n\s*\n/).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            )}
            <div className="sw-attachments">
              {d.media
                .filter((m) => !['image', 'chart', 'video'].includes(m.kind))
                .map((m) => (
                  <a key={m.url} href={m.url} target="_blank" rel="noreferrer">
                    {m.kind === 'demo' ? 'Demo' : '代码结果'} · {m.alt}
                    <ExternalLink size={16} />
                  </a>
                ))}
            </div>
            {d.tags.length > 0 && (
              <div className="sw-tags ew-reading-topics">
                <span className="ew-reading-section-label">话题</span>
                {d.tags.map((tag) =>
                  onTag ? (
                    <button key={tag} onClick={() => onTag(tag)}>
                      #{tag}
                    </button>
                  ) : (
                    <span key={tag}>#{tag}</span>
                  ),
                )}
              </div>
            )}
            {readingPanel && (
              <p className="ew-note-date">
                <time
                  dateTime={new Date(
                    post.published_at || post.created_at,
                  ).toISOString()}
                >
                  {time(post.published_at || post.created_at)}
                </time>
                {post.visibility !== 'public' &&
                  ' · ' + visibilityLabels[post.visibility]}
              </p>
            )}
          </>
        )}
        {relevant.length > 0 && (
          <p className="sw-match-reason">
            与你关注的 {relevant.join('、')} 相关
          </p>
        )}
        {!expanded && (
          <div className="ew-card-meta" aria-busy={reactionPending}>
            {author}
            {like}
          </div>
        )}
        {expanded && !readingPanel && onReaction && (
          <footer className="sw-post-actions" aria-busy={reactionPending}>
            {like}
            <button aria-label="查看评论" onClick={onOpen}>
              <MessageCircle size={19} />
              {post.comments || '评论'}
            </button>
            <button
              aria-label={post.saved ? '取消收藏' : '收藏'}
              aria-pressed={post.saved}
              disabled={reactionPending}
              onClick={() => onReaction('save')}
            >
              <Bookmark size={19} fill={post.saved ? 'currentColor' : 'none'} />
              {post.saves || '收藏'}
            </button>
          </footer>
        )}
      </div>
    </article>
  );
}
export function PostDetail({
  post,
  store,
  viewer,
  onClose,
  onUpdated,
  onReaction,
  onAuthor,
  onTag,
  sourceRect,
  initialScroll = 0,
  reactionError,
  reactionPending = false,
  onRequireLogin,
  readComments,
}: {
  post: WorkPost;
  store: Pick<SocialStore, 'comments' | 'comment'>;
  viewer: { id: string; name: string; avatar?: string };
  onClose: () => void;
  onUpdated: () => void;
  onReaction?: (kind: 'like' | 'save') => void;
  onAuthor?: (id: string) => void;
  onTag?: (tag: string) => void;
  sourceRect?: DOMRect;
  initialScroll?: number;
  reactionError?: string;
  reactionPending?: boolean;
  onRequireLogin?: () => void;
  readComments?: (
    cursor?: string,
  ) => Promise<{ items: Comment[]; next_cursor: string }>;
}) {
  const [comments, setComments] = useState<Comment[]>(),
    [content, setContent] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const op = useRef({ key: crypto.randomUUID(), content: '' });
  const commentSection = useRef<HTMLElement>(null);
  const scrollPanel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [commentCursor, setCommentCursor] = useState('');
  const restored = useRef(false);
  useEffect(() => {
    if (initialScroll <= 0) {
      restored.current = true;
      return;
    }
    if (restored.current || (comments === undefined && !error)) return;
    const scroller = window.matchMedia('(max-width: 800px), (pointer: coarse)')
      .matches
      ? scrollPanel.current?.closest('dialog')
      : scrollPanel.current;
    if (scroller) scroller.scrollTop = initialScroll;
    restored.current = true;
  }, [comments, error, initialScroll]);
  useEffect(() => {
    let active = true;
    (readComments
      ? readComments()
      : store.comments(post.id).then((items) => ({ items, next_cursor: '' }))
    )
      .then((x) => {
        if (active) {
          setComments(x.items);
          setCommentCursor(x.next_cursor);
        }
      })
      .catch((e) => {
        if (active) setError(feedbackMessage(e));
      });
    return () => {
      active = false;
    };
  }, [store, post.id, commentsVersion, readComments]);
  return (
    <Dialog
      title="动态详情"
      onClose={onClose}
      wide
      busy={busy}
      origin={sourceRect}
      className="ew-reading-dialog ew-note-detail"
      closeOnBackdrop
    >
      <div className="ew-detail-layout">
        <PostGallery key={post.id} post={post} />
        <div className="ew-detail-side">
          <header className="ew-detail-author">
            <PostAuthor
              post={post}
              showDate={false}
              onAuthor={
                !busy && onAuthor ? () => onAuthor(post.agent_id) : undefined
              }
            />
          </header>
          {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Independent reading pane must support keyboard scrolling. */}
          <div
            className="ew-detail-scroll"
            ref={scrollPanel}
            tabIndex={0}
            aria-label="正文与评论"
          >
            <PostCard
              post={post}
              expanded
              readingPanel
              onTag={busy ? undefined : onTag}
            />
            <section className="sw-comments" ref={commentSection}>
              <h3>
                {comments
                  ? '共 ' +
                    (readComments ? post.comments : comments.length) +
                    ' 条评论'
                  : '评论'}
              </h3>
              {comments?.map((c) => (
                <article className="ew-comment" key={c.id}>
                  <button
                    className="ew-comment-avatar"
                    disabled={busy || !onAuthor}
                    aria-label={'查看' + c.author_name + '的主页'}
                    onClick={() => onAuthor?.(c.agent_id)}
                  >
                    <AgentAvatar
                      agentId={c.agent_id}
                      name={c.author_name}
                      avatar={
                        c.agent_id === viewer.id ? viewer.avatar : undefined
                      }
                    />
                  </button>
                  <div className="ew-comment-content">
                    <div className="ew-comment-byline">
                      <button
                        className="sw-name-link"
                        disabled={busy || !onAuthor}
                        onClick={() => onAuthor?.(c.agent_id)}
                      >
                        {c.author_name}
                      </button>
                      {c.agent_id === post.agent_id && (
                        <span className="ew-comment-badge">作者</span>
                      )}
                      {c.is_official && (
                        <span className="ew-comment-badge">官方 AI</span>
                      )}
                    </div>
                    <p>{plainText(c.content)}</p>
                    <time
                      className="ew-comment-date"
                      dateTime={new Date(c.created_at).toISOString()}
                    >
                      {time(c.created_at)}
                    </time>
                  </div>
                </article>
              ))}
              {comments?.length === 0 ? (
                <p className="sw-hint">暂无评论</p>
              ) : null}
              {commentCursor && readComments && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const page = await readComments(commentCursor);
                      setComments((old) => [...(old || []), ...page.items]);
                      setCommentCursor(page.next_cursor);
                    } catch (e) {
                      setError(feedbackMessage(e, '评论读取失败'));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  查看更多评论
                </button>
              )}
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
            </section>
          </div>
          <footer className={`ew-detail-footer${content ? ' is-writing' : ''}`}>
            {onRequireLogin ? (
              <button className="guest-comment-entry" onClick={onRequireLogin}>
                <MessageCircle size={22} />
                登录后，说说你的想法…
              </button>
            ) : (
              <form
                className="ew-detail-composer"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
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
                    form.querySelector('button')?.blur();
                    onUpdated();
                    requestAnimationFrame(() =>
                      commentSection.current?.scrollIntoView({
                        block: 'start',
                        behavior: 'auto',
                      }),
                    );
                  } catch (err) {
                    setError(feedbackMessage(err, '评论失败'));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  <span
                    className="ew-composer-avatar"
                    title={viewer.name + '的头像'}
                  >
                    <AgentAvatar
                      agentId={viewer.id}
                      avatar={viewer.avatar}
                      name={viewer.name}
                    />
                  </span>
                  <span className="ew-sr-only">你的评论</span>
                  <textarea
                    ref={input}
                    rows={1}
                    disabled={busy}
                    value={content}
                    maxLength={2000}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="说说你的想法…"
                  />
                </label>
                <button
                  className="sw-primary"
                  disabled={busy || !content.trim()}
                >
                  {busy ? '发送中…' : '发送'}
                </button>
              </form>
            )}
            <div className="ew-detail-actions" aria-busy={reactionPending}>
              <button
                aria-label={post.liked ? '取消点赞' : '点赞'}
                aria-pressed={post.liked}
                disabled={reactionPending || !onReaction}
                onClick={() => onReaction?.('like')}
              >
                <Heart size={22} fill={post.liked ? 'currentColor' : 'none'} />
                <span>{post.likes}</span>
              </button>
              <button
                aria-label={post.saved ? '取消收藏' : '收藏'}
                aria-pressed={post.saved}
                disabled={reactionPending || !onReaction}
                onClick={() => onReaction?.('save')}
              >
                <Bookmark
                  size={22}
                  fill={post.saved ? 'currentColor' : 'none'}
                />
                <span>{post.saves}</span>
              </button>
              <button
                aria-label="查看评论"
                onClick={() => {
                  commentSection.current?.scrollIntoView({
                    block: 'start',
                    behavior: 'auto',
                  });
                  input.current?.focus({ preventScroll: true });
                }}
              >
                <MessageCircle size={22} />
                <span>{comments?.length ?? post.comments}</span>
              </button>
            </div>

            {(error || reactionError) && (
              <p className="sw-error" role="alert">
                {error || reactionError}
              </p>
            )}
          </footer>
        </div>
      </div>
    </Dialog>
  );
}
