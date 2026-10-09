import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkPost } from './model';
import { PaperCover } from './paper-cover';

export function PostGallery({ post }: { post: WorkPost }) {
  const media = post.document.media.filter((m) =>
    ['image', 'chart', 'video'].includes(m.kind),
  );
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<string[]>([]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const item = media[index];
  const change = (next: number) =>
    setIndex(Math.max(0, Math.min(media.length - 1, next)));
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- Carousel region supports arrow keys and touch swipes in addition to named navigation buttons.
    <section
      className={`ew-detail-stage${media.length ? '' : ' ew-detail-text-stage'}`}
      aria-label={media.length ? '帖子图片与视频' : '文字帖封面'}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Focus lets keyboard users switch carousel media with arrow keys.
      tabIndex={media.length > 1 ? 0 : undefined}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLVideoElement) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          change(index + (event.key === 'ArrowLeft' ? -1 : 1));
        }
      }}
      onTouchStart={(event) => {
        if (item?.kind === 'video') return;
        const t = event.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchCancel={() => {
        touch.current = null;
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const t = event.changedTouches[0];
        const dx = t.clientX - start.x;
        if (
          Math.abs(dx) > 55 &&
          Math.abs(dx) > Math.abs(t.clientY - start.y) * 1.5
        )
          change(index + (dx < 0 ? 1 : -1));
      }}
    >
      {item ? (
        <div className="ew-detail-media">
          {broken.includes(item.url) ? (
            <output className="ew-detail-media-error">
              <p>媒体暂时无法加载</p>
              <button
                onClick={() =>
                  setBroken((urls) => urls.filter((url) => url !== item.url))
                }
              >
                重新加载
              </button>
            </output>
          ) : item.kind === 'video' ? (
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- Existing uploaded-media API has no caption-track field; keep native playback controls and the supplied description.
            <video
              key={item.url}
              src={item.url}
              controls
              playsInline
              preload="metadata"
              aria-label={item.alt}
              onError={() => setBroken((urls) => [...urls, item.url])}
            />
          ) : (
            <img
              src={item.url}
              alt={item.alt || post.document.title}
              referrerPolicy="no-referrer"
              onError={() => setBroken((urls) => [...urls, item.url])}
            />
          )}
        </div>
      ) : (
        <PaperCover document={post.document} />
      )}
      {media.length > 1 && (
        <>
          <button
            className="ew-gallery-arrow ew-gallery-prev"
            aria-label="上一张"
            disabled={index === 0}
            onClick={() => change(index - 1)}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            className="ew-gallery-arrow ew-gallery-next"
            aria-label="下一张"
            disabled={index === media.length - 1}
            onClick={() => change(index + 1)}
          >
            <ChevronRight size={22} />
          </button>
          <div className="ew-gallery-pagination">
            <span aria-live="polite">
              {index + 1} / {media.length}
            </span>
            <div className="ew-gallery-dots" aria-label="选择媒体">
              {media.map((m, i) => (
                <button
                  key={`${m.url}-${i}`}
                  aria-label={`查看第 ${i + 1} 张`}
                  aria-current={index === i ? 'true' : undefined}
                  onClick={() => change(i)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
