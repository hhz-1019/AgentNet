import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { WorkPost } from './model';
import './content-motion.css';

export function ContentTabs({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className: string;
  label: string;
}) {
  return (
    <nav className={className} aria-label={label}>
      {children}
    </nav>
  );
}

// Pack natural-height cards into fine grid rows without changing DOM order.
// Only data changes animate; decoding an image or resizing settles immediately.
export function useFeedMotion(items?: WorkPost[], restored = false) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const entrances = useRef(
    new Map<string, { child: HTMLElement; animation: Animation }>(),
  );
  const sizes = useRef(
    new WeakMap<
      HTMLElement,
      { height: number; width: number; gap: number; post: WorkPost }
    >(),
  );
  useLayoutEffect(() => {
    const layoutAnimations: Animation[] = [];
    const stopLayoutAnimations = () => {
      layoutAnimations.forEach((animation) => animation.cancel());
      layoutAnimations.length = 0;
    };
    const stopAnimations = () => {
      stopLayoutAnimations();
      entrances.current.forEach(({ animation }) => animation.cancel());
      entrances.current.clear();
    };
    if (!node || !items) {
      stopAnimations();
      positions.current.clear();
      return;
    }
    const children = Array.from(node.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const ids = new Set(items.map((item) => item.id));
    entrances.current.forEach(({ child, animation }, id) => {
      if (!ids.has(id) || !node.contains(child)) {
        animation.cancel();
        entrances.current.delete(id);
      }
    });
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let width = node.clientWidth;
    let disposed = false;
    const dirty = new Set<HTMLElement>();
    let existingLayoutChanged = false;
    const pack = () => {
      const nextWidth = node.clientWidth;
      const gap = Math.max(
        0,
        Number.parseFloat(
          getComputedStyle(node).getPropertyValue('--ew-feed-gap'),
        ) || 0,
      );
      // Batch height reads before span writes. align-self:start keeps the
      // wrapper independent of its allocated grid-row height.
      // Appending a batch only measures new/changed cards, not the entire feed.
      const spans = children.map((child, index) => {
        const cached = sizes.current.get(child);
        const height =
          cached &&
          cached.width === nextWidth &&
          cached.gap === gap &&
          cached.post === items[index] &&
          !dirty.has(child)
            ? cached.height
            : child.offsetHeight;
        sizes.current.set(child, {
          height,
          width: nextWidth,
          gap,
          post: items[index],
        });
        return `span ${Math.max(1, Math.ceil(height + gap))}`;
      });
      dirty.clear();
      let changed = width !== nextWidth;
      if (changed) existingLayoutChanged = true;
      width = nextWidth;
      children.forEach((child, index) => {
        // Preserve the exact measured size when the browser skips offscreen
        // paint/layout. Do not guess masonry heights or disturb scroll anchors.
        const measured = sizes.current.get(child);
        if (measured) child.style.setProperty('--feed-card-height', `${measured.height}px`);
        child.classList.toggle('ew-feed-contained', items.length > 60);
        if (child.style.gridRowEnd !== spans[index]) {
          if (positions.current.has(items[index]?.id))
            existingLayoutChanged = true;
          child.style.gridRowEnd = spans[index];
          changed = true;
        }
      });
      return changed;
    };
    const readPositions = (retainExisting = false) => {
      const next = new Map<string, { x: number; y: number }>();
      children.forEach((child, index) => {
        if (items[index])
          next.set(
            items[index].id,
            retainExisting && positions.current.has(items[index].id)
              ? positions.current.get(items[index].id)!
              : {
                  x: child.offsetLeft,
                  y: child.offsetTop,
                },
          );
      });
      return next;
    };

    // Finish the first layout before history restoration scrolls to this feed.
    pack();
    const previous = positions.current;
    const appended =
      previous.size > 0 &&
      [...previous.keys()].every((id, index) => items[index]?.id === id);
    const next = readPositions(appended && !existingLayoutChanged);
    let addedIndex = 0;
    // First paint and offscreen prefetches are ready immediately. Only newly
    // appended cards already in view enter; scrolling never reveals a paused
    // opacity-zero row. Image decoding owns its separate blur transition.
    children.forEach((child, index) => {
      const id = items[index]?.id;
      const point = id ? next.get(id) : undefined;
      if (!id || !point) return;
      const before = previous.get(id);
      if (media.matches || restored || !child.animate) return;
      const retained = entrances.current.get(id);
      if (retained?.child === child) return;
      if (!before) {
        const rect = child.getBoundingClientRect();
        if (!appended || rect.top >= window.innerHeight || rect.bottom <= 0)
          return;
        const animation = child.animate(
          [
            { transform: 'translateY(24px)', opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 },
          ],
          {
            duration: 450,
            // Long lists must not make a newly visible card wait several seconds.
            delay: Math.min(addedIndex++, 4) * 50,
            easing: 'cubic-bezier(.2,.7,.2,1)',
            fill: 'both',
          },
        );
        animation.onfinish = () => {
          animation.cancel();
          if (entrances.current.get(id)?.animation === animation)
            entrances.current.delete(id);
        };
        entrances.current.set(id, { child, animation });
        return;
      }
      const x = before.x - point.x;
      const y = before.y - point.y;
      if (before && x === 0 && y === 0) return;
      const withinPage =
        Math.abs(y) < window.innerHeight && Math.abs(x) < node.clientWidth;
      layoutAnimations.push(
        child.animate(
          [
            {
              transform: `translate(${withinPage ? x : 0}px, ${withinPage ? y : 16}px)`,
              opacity: 1,
            },
            { transform: 'translate(0, 0)', opacity: 1 },
          ],
          {
            duration: 320,
            easing: 'cubic-bezier(.2,.7,.2,1)',
          },
        ),
      );
    });
    positions.current = next;
    let layoutFrame = 0;
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const child = entry.target as HTMLElement;
        if (child === node) return;
        const height = Math.round(
          entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height,
        );
        if (sizes.current.get(child)?.height !== height) dirty.add(child);
      });
      if (!dirty.size && width === node.clientWidth) return;
      if (disposed || layoutFrame) return;
      // Writing grid spans inside ResizeObserver causes another resize in the
      // same delivery cycle. Batch responsive packing into the next frame.
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        if (disposed) return;
        const changed = pack();
        const settled = readPositions();
        const moved = [...settled].some(([id, point]) => {
          const before = positions.current.get(id);
          return before && (before.x !== point.x || before.y !== point.y);
        });
        // Do not retain stale FLIP offsets after media or viewport changes.
        if (changed || moved) stopLayoutAnimations();
        positions.current = settled;
      });
    });
    observer.observe(node);
    children.forEach((child) => observer.observe(child));
    const reduceMotion = () => {
      if (media.matches) stopAnimations();
    };
    media.addEventListener('change', reduceMotion);
    return () => {
      disposed = true;
      cancelAnimationFrame(layoutFrame);
      observer.disconnect();
      media.removeEventListener('change', reduceMotion);
      stopLayoutAnimations();
      // Keep existing spans across append effects; removing them temporarily
      // collapses old grid rows and can move the browser's scroll anchor.
    };
  }, [items, node, restored]);
  useLayoutEffect(() => {
    const active = entrances.current;
    return () => {
      active.forEach(({ animation }) => animation.cancel());
      active.clear();
    };
  }, [node]);
  // A stable callback ref also catches a grid remount after an error or tab
  // switch when the same items array is still present.
  return setNode;
}
