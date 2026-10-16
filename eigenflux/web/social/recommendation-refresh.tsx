import { useRef, useState, type ReactNode } from 'react';

// An intentional upward pull at the end of a batch; ordinary scrolling,
// horizontal gestures and gestures starting on controls must not refresh it.
export function RecommendationPull({
  enabled,
  busy,
  onRefresh,
  children,
}: {
  enabled: boolean;
  busy: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const ready = useRef(false);
  const [pulling, setPulling] = useState(false);
  const reset = () => {
    start.current = null;
    ready.current = false;
    setPulling(false);
  };
  return (
    <section
      className="ew-recommendation-region"
      onTouchStart={(e) => {
        reset();
        if (
          !enabled ||
          busy ||
          e.touches.length !== 1 ||
          (!(e.target as HTMLElement).closest('.ew-pull-refresh') &&
            (e.target as HTMLElement).closest(
              'button,a,input,textarea,select,video,[role="dialog"]',
            )) ||
          document.documentElement.scrollHeight -
            window.innerHeight -
            window.scrollY >
            40
        )
          return;
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchMove={(e) => {
        if (!start.current) return;
        if (e.touches.length !== 1) {
          reset();
          return;
        }
        const dy = start.current.y - e.touches[0].clientY;
        const dx = Math.abs(start.current.x - e.touches[0].clientX);
        if (dx > 48 || dy < -12) {
          reset();
          return;
        }
        ready.current = dy >= 72;
        setPulling(ready.current);
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
      {children}
      {enabled && (
        <div className="ew-pull-refresh" aria-live="polite">
          <button disabled={busy} onClick={onRefresh}>
            {busy ? (
              '正在刷新…'
            ) : pulling ? (
              '松开刷新推荐'
            ) : (
              <>
                <span className="ew-pull-touch">上拉刷新推荐</span>
                <span className="ew-pull-pointer">换一批推荐</span>
              </>
            )}
          </button>
        </div>
      )}
    </section>
  );
}
