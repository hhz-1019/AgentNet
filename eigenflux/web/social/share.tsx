import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Globe2,
  ImagePlus,
  LoaderCircle,
  Users,
  Video,
  X,
} from 'lucide-react';
import { Dialog } from './dialog';
import type { Media, Visibility } from './model';
import './communication-design.css';
import './share-preview.css';

type Attachment = {
  id: string;
  file: File;
  url: string;
  kind: 'image' | 'video';
};
export function ShareComposer({
  mode = 'direct',
  authorName = '我',
  onClose,
  onPublish,
}: {
  mode?: 'direct' | 'agent';
  authorName?: string;
  onClose: () => void;
  onPublish: (input: {
    content: string;
    visibility: Visibility;
    media: Media[];
    key: string;
  }) => Promise<void>;
}) {
  const [content, setContent] = useState('');
  const [scope, setScope] = useState('公开');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'publishing' | null>(null);
  const sending = useRef(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState<string[]>([]);
  const [ready, setReady] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const images = useRef<HTMLInputElement>(null);
  const videos = useRef<HTMLInputElement>(null);
  const objectURLs = useRef(new Set<string>());
  const encodedAttachments = useRef(new Map<string, string>());
  const operation = useRef({
    key: crypto.randomUUID(),
    content: '',
    scope: '',
  });
  const throughAgent = mode === 'agent';
  useEffect(() => {
    const urls = objectURLs.current;
    const encoded = encodedAttachments.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      encoded.clear();
    };
  }, []);
  function addFiles(
    event: ChangeEvent<HTMLInputElement>,
    kind: Attachment['kind'],
  ) {
    const picked = [...(event.target.files || [])];
    const accepted: Attachment[] = [];
    const rejected: string[] = [];
    for (const file of picked) {
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
      rejected.length ? `这些文件不是所选媒体类型：${rejected.join('、')}` : '',
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
          if (sending.current || (!content.trim() && !attachments.length))
            return;
          sending.current = true;
          setBusy(true);
          setStage(attachments.length ? 'reading' : 'publishing');
          setError('');
          try {
            if (
              operation.current.content !== content ||
              operation.current.scope !== scope
            )
              operation.current = { key: crypto.randomUUID(), content, scope };
            const media = await Promise.all(
              attachments.map(async (item) => ({
                kind: item.kind,
                alt: item.file.name,
                url:
                  encodedAttachments.current.get(item.id) ||
                  (await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result !== 'string') {
                        reject(new Error('无法读取附件。'));
                        return;
                      }
                      encodedAttachments.current.set(item.id, reader.result);
                      resolve(reader.result);
                    };
                    reader.onerror = () => reject(new Error('无法读取附件。'));
                    reader.onabort = () =>
                      reject(new Error('附件读取已中断，请重试。'));
                    reader.readAsDataURL(item.file);
                  })),
              })),
            );
            setStage('publishing');
            await onPublish({
              content: content.trim(),
              visibility: scope === '好友' ? 'friends' : 'public',
              media,
              key: operation.current.key,
            });
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
              <label htmlFor="share-instruction">想分享什么？</label>
              <textarea
                id="share-instruction"
                rows={4}
                maxLength={3500}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="分享一段想法，或一个新的发现。"
              />
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
                      onClick={() => images.current?.click()}
                    >
                      <ImagePlus size={19} />
                      添加图片
                    </button>
                    <button
                      type="button"
                      onClick={() => videos.current?.click()}
                    >
                      <Video size={19} />
                      添加视频
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
                    {authorName.trim().slice(0, 1) || '我'}
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
                {content.trim() || attachments.length ? (
                  <div className="ew-share-preview-content">
                    {content.trim() && (
                      <p className="ew-share-preview-text">{content}</p>
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
                    <span aria-hidden="true" className="ew-share-empty-line" />
                    <p>让生活，留下一页。</p>
                    <span>
                      {throughAgent
                        ? '写下想分享的片段，内容会在这里慢慢成形。'
                        : '写一段想法，或放入一张照片。你的表达会在这里慢慢成形。'}
                    </span>
                    <span aria-hidden="true" className="ew-share-empty-sign">
                      elsewhere
                    </span>
                  </div>
                )}
                <footer className="ew-share-preview-note">
                  {throughAgent
                    ? '这里展示原始内容；最终动态由 Agent 整理。'
                    : '预览随输入更新；发布前，内容只属于你。'}
                </footer>
              </article>
            </section>
          </div>
          {error && (
            <p role="alert" className="sw-error ew-share-preview-error">
              {error}
            </p>
          )}
          <div className="sn-share-footer">
            <div className="sn-share-visibility">
              <label htmlFor="share-scope">谁可以看</label>
              <div>
                {scope === '好友' ? (
                  <Users size={16} aria-hidden="true" />
                ) : (
                  <Globe2 size={16} aria-hidden="true" />
                )}
                <select
                  id="share-scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option>公开</option>
                  <option>好友</option>
                </select>
              </div>
            </div>
            <button
              className="sw-primary"
              aria-busy={busy}
              disabled={busy || (!content.trim() && !attachments.length)}
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
