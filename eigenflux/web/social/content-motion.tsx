import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { WorkPost } from './model';
import './content-motion.css';

export function MovingTabs({
  children,
  className,
  label,
  active,
}: {
  children: ReactNode;
  className: string;
  label: string;
  active: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const selected = node.querySelector<HTMLElement>(
        '[aria-current], [aria-pressed="true"]',
      );
      if (!selected) return;
      node.style.setProperty('--tab-left', `${selected.offsetLeft}px`);
      node.style.setProperty('--tab-width', `${selected.offsetWidth}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);
  return (
    <nav ref={ref} className={`${className} ew-moving-tabs`} aria-label={label}>
      {children}
      <span className="ew-tab-indicator" aria-hidden="true" />
    </nav>
  );
}

// Track layout positions, independent of scrolling and any running transforms.
// Only actual data changes introduce or move cards; this never simulates activity.
export function useFeedMotion(items?: WorkPost[]) {
  const ref = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const animations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const node = ref.current;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    if (!node || !items) {
      positions.current.clear();
      return;
    }
    const previous = positions.current;
    const next = new Map<string, { x: number; y: number }>();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    Array.from(node.children).forEach((child, index) => {
      if (!(child instanceof HTMLElement) || !items[index]) return;
      const id = items[index].id;
      const point = { x: child.offsetLeft, y: child.offsetTop };
      const before = previous.get(id);
      next.set(id, point);
      if (reduce || !child.animate) return;
      const x = before ? before.x - point.x : 0;
      const y = before ? before.y - point.y : 16;
      if (before && x === 0 && y === 0) return;
      const withinPage =
        Math.abs(y) < window.innerHeight && Math.abs(x) < node.clientWidth;
      animations.current.push(
        child.animate(
          [
            {
              transform: `translate(${withinPage ? x : 0}px, ${withinPage ? y : 16}px)`,
              opacity: before ? 1 : 0,
            },
            { transform: 'translate(0, 0)', opacity: 1 },
          ],
          {
            duration: 320,
            easing: 'cubic-bezier(.2,.7,.2,1)',
            delay: before ? 0 : Math.min(index, 5) * 30,
          },
        ),
      );
    });
    positions.current = next;
    const observer = new ResizeObserver(() => {
      Array.from(node.children).forEach((child, index) => {
        if (child instanceof HTMLElement && items[index]) {
          positions.current.set(items[index].id, {
            x: child.offsetLeft,
            y: child.offsetTop,
          });
        }
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [items]);
  useLayoutEffect(
    () => () => animations.current.forEach((animation) => animation.cancel()),
    [],
  );
  return ref;
}
