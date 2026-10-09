import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

// Pack natural-height cards into fine grid rows without changing DOM order.
// Only data changes animate; decoding an image or resizing settles immediately.
export function useFeedMotion(items?: WorkPost[]) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const animations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const stopAnimations = () => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
    };
    stopAnimations();
    if (!node || !items) {
      positions.current.clear();
      return;
    }
    const children = Array.from(node.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let width = node.clientWidth;
    let disposed = false;
    const pack = () => {
      const gap = Math.max(
        0,
        Number.parseFloat(
          getComputedStyle(node).getPropertyValue('--ew-feed-gap'),
        ) || 0,
      );
      // Read every natural height before writing any spans. align-self:start
      // keeps the wrapper independent of its allocated grid-row height.
      const spans = children.map(
        (child) => `span ${Math.max(1, Math.ceil(child.offsetHeight + gap))}`,
      );
      let changed = width !== node.clientWidth;
      width = node.clientWidth;
      children.forEach((child, index) => {
        if (child.style.gridRowEnd !== spans[index]) {
          child.style.gridRowEnd = spans[index];
          changed = true;
        }
      });
      return changed;
    };
    const readPositions = () => {
      const next = new Map<string, { x: number; y: number }>();
      children.forEach((child, index) => {
        if (items[index])
          next.set(items[index].id, {
            x: child.offsetLeft,
            y: child.offsetTop,
          });
      });
      return next;
    };

    // Finish the first layout before history restoration scrolls to this feed.
    pack();
    const previous = positions.current;
    const next = readPositions();
    children.forEach((child, index) => {
      const id = items[index]?.id;
      const point = id ? next.get(id) : undefined;
      if (!id || !point) return;
      const before = previous.get(id);
      if (media.matches || !child.animate) return;
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
      if (disposed) return;
      const changed = pack();
      const settled = readPositions();
      const moved = [...settled].some(([id, point]) => {
        const before = positions.current.get(id);
        return before && (before.x !== point.x || before.y !== point.y);
      });
      // An in-flight FLIP must not keep stale offsets after media or width
      // changes. The observer's initial unchanged notification leaves it alone.
      if (changed || moved) stopAnimations();
      positions.current = settled;
    });
    observer.observe(node);
    children.forEach((child) => observer.observe(child));
    const reduceMotion = () => {
      if (media.matches) stopAnimations();
    };
    media.addEventListener('change', reduceMotion);
    return () => {
      disposed = true;
      observer.disconnect();
      media.removeEventListener('change', reduceMotion);
      stopAnimations();
      children.forEach((child) => child.style.removeProperty('grid-row-end'));
    };
  }, [items, node]);
  // A stable callback ref also catches a grid remount after an error or tab
  // switch when the same items array is still present.
  return setNode;
}
