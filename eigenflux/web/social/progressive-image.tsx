import { useLayoutEffect, useRef, useState } from 'react';
import type { Media } from './model';
import { imageLead, imageSources } from './image-loading';
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
  detail = false,
}: {
  media: Media;
  alt?: string;
  onError: () => void;
  standalone?: boolean;
  detail?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [started, setStarted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [firstScreen, setFirstScreen] = useState(false);
  const [instant, setInstant] = useState(false);
  const requestedAt = useRef(0);
  // Only visible media participates in entry readiness; below-fold prefetch
  // continues independently. A failed image settles into its existing fallback.
  useEntryPreparation(firstScreen && started && !loaded && !failed);
  const original = useRef<HTMLImageElement>(null);
  const sources = imageSources(media.url, detail || standalone, media.width);
  const fail = () => {
    setFailed(true);
    onError();
  };
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
  useLayoutEffect(() => {
    alive.current = true;
    const node = frame.current;
    if (!node) return;
    const connection = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; saveData?: boolean };
      }
    ).connection;
    const lead = connection?.saveData
      ? 300
      : imageLead(
          innerHeight,
          /(^|-)2g|3g/.test(connection?.effectiveType || ''),
        );
    const bounds = node.getBoundingClientRect();
    const start = () => {
      const rect = node.getBoundingClientRect();
      setFirstScreen(rect.top < innerHeight && rect.bottom > 0);
      requestedAt.current = performance.now();
      setStarted(true);
    };
    // Start visible images during layout; don't wait for an observer callback.
    if (bounds.top < innerHeight + lead && bounds.bottom > -lead) start();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!requestedAt.current) start();
        observer.disconnect();
      },
      { rootMargin: `${lead}px 0px` },
    );
    observer.observe(node);
    return () => {
      alive.current = false;
      observer.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    const image = original.current;
    if (started && image?.complete && image.naturalWidth) {
      setInstant(true);
      setLoaded(true);
    }
  }, [started]);
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
      data-image-state={
        failed ? 'error' : loaded ? 'loaded' : started ? 'loading' : 'waiting'
      }
      data-image-instant={instant || undefined}
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
        ref={original}
        className="ew-image-original"
        src={started ? sources.src : undefined}
        srcSet={started ? sources.srcSet : undefined}
        sizes={sources.sizes}
        fetchPriority={firstScreen ? 'high' : 'auto'}
        alt={alt}
        referrerPolicy="no-referrer"
        decoding="async"
        onLoad={(event) => {
          const image = event.currentTarget;
          // Reveal decoded pixels rather than changing layout or fading a
          // network-complete image that still needs main-thread decoding.
          void image.decode().then(
            () => {
              if (alive.current) {
                setInstant(performance.now() - requestedAt.current < 100);
                setLoaded(true);
              }
            },
            () => {
              if (alive.current) fail();
            },
          );
        }}
        onError={fail}
      />
    </div>
  );
}
