import { useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from '../icons';

export function RefreshButton({
  busy,
  onRefresh,
  disabled = false,
}: {
  busy: boolean;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="ew-feed-refresh"
      disabled={busy || disabled}
      onClick={onRefresh}
      aria-label="刷新动态"
      aria-busy={busy}
    >
      <RefreshCw size={20} aria-hidden="true" />
    </button>
  );
}

// Refresh only after a deliberate downward gesture starting at the page top.
export function FeedPull({
  enabled,
  busy,
  onRefresh,
  children,
  as: Container = 'section',
  id,
  className = '',
}: {
  enabled: boolean;
  busy: boolean;
  onRefresh: () => void;
  children: ReactNode;
  as?: 'section' | 'main';
  id?: string;
  className?: string;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const ready = useRef(false);
  const [distance, setDistance] = useState(0);
  function reset() {
    start.current = null;
    ready.current = false;
    setDistance(0);
  }
  return (
    <Container
      id={id}
      className={`${className}${enabled ? ' ew-feed-region' : ''}`}
      onTouchStart={(e) => {
        reset();
        if (
          !enabled ||
          busy ||
          e.touches.length !== 1 ||
          window.scrollY > 1 ||
          (e.target as HTMLElement).closest(
            'input,textarea,select,video,[role="dialog"],[contenteditable="true"]',
          )
        )
          return;
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchMove={(e) => {
        if (!start.current) return;
        if (e.touches.length !== 1 || window.scrollY > 1) {
          reset();
          return;
        }
        const dy = e.touches[0].clientY - start.current.y;
        const dx = Math.abs(e.touches[0].clientX - start.current.x);
        if (dx > 40 || dy < -10) {
          reset();
          return;
        }
        ready.current = dy >= 80;
        setDistance(Math.max(0, Math.min(dy * 0.45, 56)));
      }}
      onTouchEnd={(e) => {
        const trigger = ready.current && enabled && !busy;
        reset();
        if (trigger) {
          e.preventDefault();
          onRefresh();
        }
      }}
      onTouchCancel={reset}
    >
      {enabled && (
        <div
          className="ew-pull-indicator"
          style={{ height: distance }}
          aria-hidden="true"
        >
          <RefreshCw
            size={22}
            style={{ transform: `rotate(${distance * 4}deg)` }}
          />
        </div>
      )}
      {children}
    </Container>
  );
}
