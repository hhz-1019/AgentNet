import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '../icons';

/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- A focusable scroll region supports keyboard panning as an alternative to pointer dragging. */

// Horizontal overflow stays inside the viewport. A drag must cross a threshold
// before it captures the pointer, so ordinary button clicks keep working.
export function DragRail({
  children,
  label,
  className = '',
  resetKey = '',
  pageGap = 0,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  resetKey?: string;
  pageGap?: number;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const gesture = useRef({ pointer: -1, x: 0, scroll: 0, moved: false });
  const [edges, setEdges] = useState({ before: false, after: false });
  const [dragging, setDragging] = useState(false);
  const measure = () => {
    const el = rail.current;
    if (!el) return;
    const before = el.scrollLeft > 2;
    const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((old) =>
      old.before === before && old.after === after ? old : { before, after },
    );
  };
  useLayoutEffect(() => {
    const el = rail.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [children]);
  useLayoutEffect(() => {
    if (rail.current) rail.current.scrollLeft = 0;
    measure();
  }, [resetKey]);
  const step = (direction: number) => {
    const el = rail.current;
    if (el)
      el.scrollBy({
        left: direction * (el.clientWidth + pageGap),
        behavior: 'instant',
      });
  };
  return (
    <div className={'mb-drag-wrap ' + className}>
      <section
        ref={rail}
        className="mb-drag-rail"
        aria-label={label}
        tabIndex={0}
        data-dragging={dragging || undefined}
        data-overflow={edges.before || edges.after || undefined}
        onScroll={measure}
        onDragStart={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            step(e.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
        onPointerDown={(e) => {
          gesture.current.moved = false;
          if (
            e.pointerType !== 'mouse' ||
            e.button !== 0 ||
            (e.target as HTMLElement).closest(
              'input,textarea,select,[contenteditable]',
            )
          )
            return;
          gesture.current = {
            pointer: e.pointerId,
            x: e.clientX,
            scroll: e.currentTarget.scrollLeft,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (g.pointer !== e.pointerId || !e.buttons) return;
          const dx = e.clientX - g.x;
          if (!g.moved && Math.abs(dx) < 7) return;
          if (!g.moved) {
            g.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }
          e.preventDefault();
          e.currentTarget.scrollLeft = g.scroll - dx;
        }}
        onPointerUp={(e) => {
          gesture.current.pointer = -1;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => {
          gesture.current.pointer = -1;
          setDragging(false);
        }}
        onClickCapture={(e) => {
          if (gesture.current.moved && e.detail > 0) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {children}
      </section>
      {(edges.before || edges.after) && (
        <div className="mb-rail-arrows">
          <button
            type="button"
            aria-label={label + '：上一页'}
            disabled={!edges.before}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label={label + '：下一页'}
            disabled={!edges.after}
            onClick={() => step(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
