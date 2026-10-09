import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Video, X } from 'lucide-react';
import { Dialog } from './dialog';
import type { Media, Visibility } from './model';

type Attachment = {
  id: string;
  file: File;
  url: string;
  kind: 'image' | 'video';
};
export function ShareComposer({
  onClose,
  onPublish,
}: {
  onClose: () => void;
  onPublish: (input: {
    content: string;
    visibility: Visibility;
    media: Media[];
  }) => Promise<void>;
}) {
  const [content, setContent] = useState('');
  const [scope, setScope] = useState('公开');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState('');
  const [broken, setBroken] = useState<string[]>([]);
  const images = useRef<HTMLInputElement>(null);
  const videos = useRef<HTMLInputElement>(null);
  const objectURLs = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectURLs.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
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
  }
  return (
    <Dialog title="发布动态" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending.current || (!content.trim() && !attachments.length))
            return;
          sending.current = true;
          setBusy(true);
          setError('');
          try {
            const media = await Promise.all(
              attachments.map(async (item) => ({
                kind: item.kind,
                alt: item.file.name,
                url: await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () =>
                    typeof reader.result === 'string'
                      ? resolve(reader.result)
                      : reject(new Error('无法读取附件。'));
                  reader.onerror = () => reject(new Error('无法读取附件。'));
                  reader.readAsDataURL(item.file);
                }),
              })),
            );
            await onPublish({
              content: content.trim(),
              visibility: scope === '好友' ? 'friends' : 'public',
              media,
            });
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : '发布失败，请重试。');
          } finally {
            sending.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset className="sn-share-fields" disabled={busy}>
          <label htmlFor="share-instruction">想分享什么？</label>
          <textarea
            id="share-instruction"
            rows={4}
            maxLength={3500}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="sn-media-actions">
            <button type="button" onClick={() => images.current?.click()}>
              <ImagePlus size={19} />
              添加图片
            </button>
            <button type="button" onClick={() => videos.current?.click()}>
              <Video size={19} />
              添加视频
            </button>
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
          {error && (
            <p role="alert" className="sw-error">
              {error}
            </p>
          )}
          {attachments.length > 0 && (
            <div className="sn-media-grid" aria-label="已选择的媒体">
              {attachments.map((item) => (
                <figure key={item.id}>
                  {broken.includes(item.id) ? (
                    <div className="sn-media-placeholder">
                      浏览器无法预览此文件，可移除或换一个格式。
                    </div>
                  ) : item.kind === 'image' ? (
                    <img
                      src={item.url}
                      alt={item.file.name}
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
                      onError={() => setBroken((ids) => [...ids, item.id])}
                    />
                  )}
                  <figcaption>
                    {item.kind === 'image' ? '图片' : '视频'} · {item.file.name}
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
          <label htmlFor="share-scope">谁可以看</label>
          <select
            id="share-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option>公开</option>
            <option>好友</option>
          </select>
          <button
            className="sw-primary"
            disabled={busy || (!content.trim() && !attachments.length)}
          >
            {busy ? '发布中…' : '发布'}
          </button>
        </fieldset>
      </form>
    </Dialog>
  );
}
