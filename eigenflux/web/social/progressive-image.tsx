import { useEffect, useRef, useState } from 'react';
import type { Media } from './model';
import { useEntryPreparation } from '../entry-preparation';
import './progressive-image.css';

export function imageFrameRatio(media: Media) {
  return typeof media.width === 'number' &&
    typeof media.height === 'number' &&
    Number.isFinite(media.width) &&
    Number.isFinite(media.height) &&
    media.width > 0 &&
    media.height > 0
    ? Math.max(0.66, Math.min(1.6, media.width / media.height))
    : 1;
}

export function ProgressiveImage({
  media,
  alt = media.alt,
  onError,
  standalone = false,
}: {
  media: Media;
  alt?: string;
  onError: () => void;
  standalone?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [started, setStarted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [firstScreen, setFirstScreen] = useState(false);
  useEntryPreparation(firstScreen && started && !loaded);
  // Inline tiny rasters need no request and cannot start the original early.
  const preview =
    typeof media.preview === 'string' &&
    media.preview.length <= 8192 &&
    /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=\r\n]+$/.test(media.preview)
      ? media.preview
      : undefined;
  const color =
    typeof media.color === 'string' && /^#[0-9a-f]{6}$/i.test(media.color)
      ? media.color
      : undefined;
  useEffect(() => {
    alive.current = true;
    const node = frame.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        const bounds = node.getBoundingClientRect();
        setFirstScreen(bounds.top < window.innerHeight && bounds.bottom > 0);
        setStarted(true);
        observer.disconnect();
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(node);
    return () => {
      alive.current = false;
      observer.disconnect();
    };
  }, []);
  return (
    <div
      ref={frame}
      className={`ew-progressive-image${loaded ? ' is-loaded' : ''}`}
      style={{
        backgroundColor: color,
        ...(standalone
          ? { height: 'auto', aspectRatio: imageFrameRatio(media) }
          : {}),
      }}
      data-image-state={loaded ? 'loaded' : started ? 'loading' : 'waiting'}
    >
      {preview && !previewFailed && (
        <img
          className="ew-image-preview"
          src={preview}
          alt=""
          aria-hidden="true"
          onError={() => setPreviewFailed(true)}
        />
      )}
      <img
        className="ew-image-original"
        src={started ? media.url : undefined}
        alt={alt}
        referrerPolicy="no-referrer"
        decoding="async"
        onLoad={(event) => {
          const image = event.currentTarget;
          // Reveal decoded pixels rather than changing layout or fading a
          // network-complete image that still needs main-thread decoding.
          void image.decode().then(
            () => {
              if (alive.current) setLoaded(true);
            },
            () => {
              if (alive.current) onError();
            },
          );
        }}
        onError={onError}
      />
    </div>
  );
}
