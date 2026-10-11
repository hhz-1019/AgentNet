import { AgentAvatar } from '../avatar';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Globe2,
  Image,
  Plus,
  Hash,
  LoaderCircle,
  Users,
  Video,
  X,
} from '../icons';
import { Dialog } from './dialog';
import { parseTags, type Media, type Visibility } from './model';
import './composer-refinement.css';
import './communication-design.css';
import './share-preview.css';

type Attachment = {
  id: string;
  file: File;
  url: string;
  kind: 'image' | 'video';
};
type ShareDraft = {
  title: string;
  tags: string;
  content: string;
  scope: string;
  files: Pick<Attachment, 'id' | 'file' | 'kind'>[];
  operation: { key: string; signature: string };
};
// Keep unfinished files in memory, not in a second persistent media store.
const unfinishedShares = new Map<string, ShareDraft>();
export function ShareComposer({
  mode = 'direct',
  authorName = '我',
  agentId,
  avatar,
  draftKey,
  onClose,
  onPublish,
  upload,
}: {
  upload?: (file: File, key: string) => Promise<string>;
  mode?: 'direct' | 'agent';
  authorName?: string;
  agentId?: string;
  avatar?: string;
  draftKey?: string;
  onClose: () => void;
  onPublish: (input: {
    title: string;
    tags: string[];
    content: string;
    visibility: Visibility;
    media: Media[];
    key: string;
  }) => Promise<void>;
}) {
  const storageKey = `${mode}:${draftKey || authorName}`;
  const [restored] = useState(() => unfinishedShares.get(storageKey));
  const [title, setTitle] = useState(restored?.title || '');
  const [tags, setTags] = useState(restored?.tags || '');
  const parsedTags = parseTags(tags);
  const tagError =
    parsedTags.length > 8
      ? '最多添加 8 个 Tag。'
      : parsedTags.some((tag) => Array.from(tag).length > 30)
        ? '每个 Tag 最多 30 字。'
        : '';
  const [content, setContent] = useState(restored?.content || '');
  const [scope, setScope] = useState(restored?.scope || '公开');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'publishing' | null>(null);
  const sending = useRef(false);
  const [attachments, setAttachments] = useState<Attachment[]>(() =>
    (restored?.files || []).map((file) => ({
      ...file,
      url: URL.createObjectURL(file.file),
    })),
  );
  const [error, setError] = useState('');
  const [broken, setBroken] = useState<string[]>([]);
  const [ready, setReady] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const images = useRef<HTMLInputElement>(null);
  const videos = useRef<HTMLInputElement>(null);
  const objectURLs = useRef(new Set(attachments.map((item) => item.url)));
  const encodedAttachments = useRef(new Map<string, string>());
  const operation = useRef(
    restored?.operation || { key: crypto.randomUUID(), signature: '' },
  );
  const completed = useRef(false);
  const latestDraft = useRef<ShareDraft>({
    title,
    tags,
    content,
    scope,
    files: attachments,
    operation: operation.current,
  });
  const throughAgent = mode === 'agent';
  useEffect(() => {
    latestDraft.current = {
      title,
      tags,
      content,
      scope,
      files: attachments,
      operation: operation.current,
    };
  }, [title, tags, content, scope, attachments]);
  useEffect(() => {
    const urls = objectURLs.current;
    const encoded = encodedAttachments.current;
    return () => {
      const draft = latestDraft.current;
      if (
        !completed.current &&
        (draft.title.trim() ||
          draft.tags.trim() ||
          draft.content.trim() ||
          draft.files.length)
      ) {
        unfinishedShares.set(storageKey, {
          ...draft,
          operation: operation.current,
        });
      } else {
        unfinishedShares.delete(storageKey);
      }
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      encoded.clear();
    };
  }, [storageKey]);
  function addFiles(
    event: ChangeEvent<HTMLInputElement>,
    kind: Attachment['kind'],
  ) {
    const picked = [...(event.target.files || [])];
    const accepted: Attachment[] = [];
    const rejected: string[] = [];
    for (const file of picked) {
      if (
        upload &&
        (file.size > 8 * 1024 * 1024 ||
          !['image/png', 'image/jpeg', 'video/mp4', 'video/webm'].includes(
            file.type,
          ) ||
          attachments.length + accepted.length >= 4)
      ) {
        rejected.push(file.name);
        continue;
      }
      if (!file.type.startsWith(kind + '/')) {
        rejected.push(file.name);
        continue;
      }
      const url = URL.createObjectURL(file);
      objectURLs.current.add(url);
      accepted.push({ id: crypto.randomUUID(), file, url, kind });
    }
    setAttachments((existing) => [...existing, ...accepted]);
    setError(
      rejected.length
        ? `附件未添加（最多 4 个，每个 8 MB，PNG/JPEG/MP4/WebM）：${rejected.join('、')}`
        : '',
    );
    event.target.value = '';
  }
  function remove(id: string) {
    const attachment = attachments.find((item) => item.id === id);
    if (attachment) {
      URL.revokeObjectURL(attachment.url);
      objectURLs.current.delete(attachment.url);
    }
    setAttachments((items) => items.filter((item) => item.id !== id));
    setBroken((ids) => ids.filter((item) => item !== id));
    setReady((ids) => ids.filter((item) => item !== id));
    encodedAttachments.current.delete(id);
  }
  return (
    <Dialog
      title={throughAgent ? '交给 Agent 发布' : '发布动态'}
      onClose={onClose}
      busy={busy}
      wide
    >
      <form
        className="sn-share-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            sending.current ||
            tagError ||
            (!title.trim() && !content.trim() && !attachments.length)
          )
            return;
          sending.current = true;
          setBusy(true);
          setStage(attachments.length ? 'reading' : 'publishing');
          setError('');
          try {
            const signature = JSON.stringify([
              title.trim(),
              parsedTags,
              content,
              scope,
              attachments.map((item) => item.id),
            ]);
            if (operation.current.signature !== signature)
              operation.current = { key: crypto.randomUUID(), signature };
            const media = await Promise.all(
              attachments.map(async (item) => ({
                kind: item.kind,
                alt: item.file.name,
                url:
                  (encodedAttachments.current.get(item.id) ?? '') ||
                  (upload
                    ? await upload(item.file, item.id).then((url) => {
                        encodedAttachments.current.set(item.id, url);
                        return url;
                      })
                    : await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result !== 'string') {
                            reject(new Error('无法读取附件。'));
                            return;
                          }
                          encodedAttachments.current.set(
                            item.id,
                            reader.result,
                          );
                          resolve(reader.result);
                        };
                        reader.onerror = () =>
                          reject(new Error('无法读取附件。'));
                        reader.onabort = () =>
                          reject(new Error('附件读取已中断，请重试。'));
                        reader.readAsDataURL(item.file);
                      })),
              })),
            );
            setStage('publishing');
            await onPublish({
              title: title.trim(),
              tags: parsedTags,
              content: content.trim(),
              visibility: scope === '好友' ? 'friends' : 'public',
              media,
              key: operation.current.key,
            });
            completed.current = true;
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : '发布失败，请重试。');
          } finally {
            sending.current = false;
            setBusy(false);
            setStage(null);
          }
        }}
      >
        <fieldset className="sn-share-fields" disabled={busy}>
          {restored && (
            <output className="sn-draft-restored">
              已继续上次未发布的内容
            </output>
          )}
          <button
            className="ew-share-preview-toggle"
            type="button"
            aria-expanded={showPreview}
            aria-controls="share-preview"
            onClick={() => setShowPreview((shown) => !shown)}
          >
            {showPreview ? <ArrowLeft size={17} /> : <ArrowUpRight size={17} />}
            {showPreview ? '继续编辑' : '查看预览'}
          </button>
          <div
            className={`ew-share-layout${showPreview ? ' is-previewing' : ''}`}
          >
            <div className="ew-share-editor">
              <div className="ew-share-writing">
                <label className="sw-sr-only" htmlFor="share-title">
                  标题
                </label>
                <input
                  id="share-title"
                  className="ew-share-title-input"
                  data-dialog-autofocus
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="写一个标题…"
                />
                <label className="sw-sr-only" htmlFor="share-instruction">
                  正文
                </label>
                <textarea
                  id="share-instruction"
                  rows={6}
                  maxLength={3500}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="分享一段想法，或一个新的发现。"
                />
              </div>
              <div className="ew-share-tags">
                <label htmlFor="share-tags">
                  <Hash size={18} aria-hidden="true" />
                  Tag <small>最多 8 个，用逗号分隔</small>
                </label>
                <input
                  id="share-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="例如：散步，生活，灵感"
                  maxLength={300}
                  aria-invalid={!!tagError}
                  aria-describedby={tagError ? 'share-tags-error' : undefined}
                />
                {parsedTags.length > 0 && (
                  <div className="ew-share-tag-list" aria-label="已添加的 Tag">
                    {parsedTags.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                )}
                {tagError && (
                  <p id="share-tags-error" className="sw-error" role="alert">
                    {tagError}
                  </p>
                )}
              </div>
              {throughAgent && (
                <p className="sw-hint">
                  Agent 会按所选范围整理并发布，提交即授权本次分享。
                </p>
              )}
              <div className="sn-share-tools">
                {!throughAgent && (
                  <div className="sn-media-actions">
                    <button
                      type="button"
                      aria-label="添加图片"
                      title="添加图片"
                      onClick={() => images.current?.click()}
                    >
                      <Image size={30} aria-hidden="true" />
                      <Plus size={20} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="添加视频"
                      title="添加视频"
                      onClick={() => videos.current?.click()}
                    >
                      <Video size={30} aria-hidden="true" />
                      <Plus size={20} aria-hidden="true" />
                    </button>
                  </div>
                )}
                <span
                  className="sn-share-count"
                  aria-label={`已输入 ${content.length} 字，最多 3500 字`}
                >
                  {content.length} / 3500
                </span>
              </div>
              <input
                className="sw-sr-only"
                ref={images}
                type="file"
                accept="image/*"
                multiple
                aria-label="选择图片"
                onChange={(e) => addFiles(e, 'image')}
                tabIndex={-1}
              />
              <input
                className="sw-sr-only"
                ref={videos}
                type="file"
                accept="video/*"
                multiple
                aria-label="选择视频"
                onChange={(e) => addFiles(e, 'video')}
                tabIndex={-1}
              />
              {attachments.length > 0 && (
                <div className="sn-media-grid" aria-label="已选择的媒体">
                  {attachments.map((item) => (
                    <figure
                      key={item.id}
                      className={broken.includes(item.id) ? ' is-broken' : ''}
                    >
                      {!ready.includes(item.id) &&
                        !broken.includes(item.id) && (
                          <output className="sn-media-loading">
                            <LoaderCircle
                              size={18}
                              className="sn-loading-icon"
                            />
                            正在读取预览…
                          </output>
                        )}
                      {broken.includes(item.id) ? (
                        <div className="sn-media-placeholder">
                          浏览器无法预览此文件，可移除或换一个格式。
                        </div>
                      ) : item.kind === 'image' ? (
                        <img
                          src={item.url}
                          alt={item.file.name}
                          onLoad={() => setReady((ids) => [...ids, item.id])}
                          onError={() => setBroken((ids) => [...ids, item.id])}
                        />
                      ) : (
                        <video
                          src={item.url}
                          controls
                          muted
                          playsInline
                          preload="metadata"
                          aria-label={item.file.name}
                          onLoadedMetadata={() =>
                            setReady((ids) => [...ids, item.id])
                          }
                          onError={() => setBroken((ids) => [...ids, item.id])}
                        />
                      )}
                      <figcaption>
                        <span className="sn-media-filename">
                          {item.file.name}
                        </span>
                        <small>
                          {item.kind === 'image' ? '图片' : '视频'} ·{' '}
                          {item.file.size < 1024 * 1024
                            ? `${Math.max(1, Math.round(item.file.size / 1024))} KB`
                            : `${(item.file.size / (1024 * 1024)).toFixed(1)} MB`}
                        </small>
                      </figcaption>
                      <button
                        className="sn-media-remove"
                        type="button"
                        aria-label={`移除 ${item.file.name}`}
                        onClick={() => remove(item.id)}
                      >
                        <X size={16} />
                      </button>
                    </figure>
                  ))}
                </div>
              )}
            </div>
            <section
              id="share-preview"
              className="ew-share-preview"
              aria-label={throughAgent ? '待交给 Agent 的内容' : '动态实时预览'}
            >
              <header className="ew-share-preview-heading">
                <span>{throughAgent ? '待交给 Agent 的内容' : '动态预览'}</span>
                <small>尚未发布</small>
              </header>
              <article className="ew-share-preview-paper">
                <div className="ew-share-preview-author">
                  <span className="ew-share-preview-avatar" aria-hidden="true">
                    <AgentAvatar
                      agentId={agentId}
                      avatar={avatar}
                      name={authorName}
                    />
                  </span>
                  <div>
                    <strong>{authorName.trim() || '我'}</strong>
                    <span>
                      {scope === '好友' ? (
                        <Users size={14} aria-hidden="true" />
                      ) : (
                        <Globe2 size={14} aria-hidden="true" />
                      )}
                      {scope === '好友' ? '好友可见' : '公开可见'}
                    </span>
                  </div>
                </div>
                {title.trim() || content.trim() || attachments.length ? (
                  <div className="ew-share-preview-content">
                    {title.trim() && <h2>{title}</h2>}
                    {content.trim() && (
                      <p className="ew-share-preview-text">{content}</p>
                    )}
                    {parsedTags.length > 0 && (
                      <div className="ew-share-tag-list">
                        {parsedTags.map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </div>
                    )}
                    {attachments.length > 0 && (
                      <div
                        className={`ew-share-preview-gallery${attachments.length === 1 ? ' is-single' : ''}`}
                        aria-label="附件预览"
                      >
                        {attachments.map((item) => (
                          <figure key={item.id}>
                            {broken.includes(item.id) ? (
                              <div className="ew-share-preview-unavailable">
                                此附件暂时无法预览
                              </div>
                            ) : item.kind === 'image' ? (
                              <img src={item.url} alt={item.file.name} />
                            ) : (
                              <video
                                src={item.url}
                                controls
                                muted
                                playsInline
                                preload="metadata"
                                aria-label={`预览 ${item.file.name}`}
                              />
                            )}
                            <figcaption>{item.file.name}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="ew-share-preview-empty">
                    <p>还没有内容</p>
                  </div>
                )}
                {throughAgent && (
                  <footer className="ew-share-preview-note">
                    最终动态由 Agent 整理。
                  </footer>
                )}
              </article>
            </section>
          </div>
          {error && (
            <p role="alert" className="sw-error ew-share-preview-error">
              {error}
            </p>
          )}
          <div className="sn-share-footer">
            <fieldset className="sn-share-visibility">
              <legend>谁可以看</legend>
              <div>
                {[
                  { value: '公开', label: '公开', Icon: Globe2 },
                  { value: '好友', label: '好友可见', Icon: Users },
                ].map(({ value, label, Icon }) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="share-scope"
                      value={value}
                      checked={scope === value}
                      onChange={() => setScope(value)}
                    />
                    <span>
                      <Icon size={20} aria-hidden="true" />
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              className="sw-primary"
              aria-busy={busy}
              disabled={
                busy ||
                !!tagError ||
                (!title.trim() && !content.trim() && !attachments.length)
              }
            >
              {busy && <LoaderCircle size={16} className="sn-loading-icon" />}
              {stage === 'reading'
                ? '读取附件中…'
                : busy
                  ? throughAgent
                    ? '正在交给 Agent…'
                    : '发布中…'
                  : throughAgent
                    ? '交给 Agent 发布'
                    : '发布'}
            </button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
