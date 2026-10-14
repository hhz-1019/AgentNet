import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { AgentAvatar } from '../avatar';
import {
  packMoments,
  MOMENT_HOVER_SCALE,
  type MomentCircle,
} from './moment-layout';

/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The spatial viewport is focusable so keyboard users can pan with arrows and Home, just like a scroll region. */

type Group = { id: string; name: string; priority: number; items: unknown[] };
type Point = { x: number; y: number };
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));

export function MomentField({
  groups,
  frozen,
  onSelect,
  onReachEdge,
}: {
  groups: Group[];
  frozen: boolean;
  onSelect: (id: string, origin: HTMLElement) => void;
  onReachEdge: () => void;
}) {
  const viewport = useRef<HTMLElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 700 });
  const [circles, setCircles] = useState(() => packMoments(groups));
  const signature = JSON.stringify(groups.map((g) => [g.id, g.priority]));
  useEffect(() => {
    if (!frozen)
      setCircles(
        packMoments(
          JSON.parse(signature).map(([id, priority]: [string, number]) => ({
            id,
            priority,
          })),
        ),
      );
  }, [signature, frozen]);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = clamp(Math.min(size.width, size.height) / 620, 0.7, 1);
  const camera = useRef({ x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0 });
  const frame = useRef(0);
  const previousTime = useRef(0);
  const reduced = useRef(false);
  const drag = useRef<{
    id: number;
    start: Point;
    last: Point;
    time: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const bounds = useRef({ left: 0, right: 0, top: 0, bottom: 0 });
  const edge = useRef(onReachEdge);
  edge.current = onReachEdge;
  bounds.current = {
    left: Math.min(
      -size.width * 0.22,
      size.width / 2 -
        Math.max(...circles.map((c) => (c.x + c.radius) * scale)) -
        32,
    ),
    right: Math.max(
      size.width * 0.22,
      -size.width / 2 -
        Math.min(...circles.map((c) => (c.x - c.radius) * scale)) +
        32,
    ),
    top: Math.min(
      -size.height * 0.22,
      size.height / 2 -
        Math.max(...circles.map((c) => (c.y + c.radius) * scale)) -
        32,
    ),
    bottom: Math.max(
      size.height * 0.22,
      -size.height / 2 -
        Math.min(...circles.map((c) => (c.y - c.radius) * scale)) +
        32,
    ),
  };
  function paint() {
    if (world.current)
      world.current.style.transform = `translate3d(${camera.current.x}px, ${camera.current.y}px, 0)`;
  }
  function limit() {
    const c = camera.current,
      b = bounds.current;
    const x = clamp(c.tx, b.left, b.right),
      y = clamp(c.ty, b.top, b.bottom);
    if (x !== c.tx) c.vx = 0;
    if (y !== c.ty) c.vy = 0;
    c.tx = x;
    c.ty = y;
  }
  function tick(time: number) {
    const dt = Math.min(
      32,
      Math.max(1, time - (previousTime.current || time - 16)),
    );
    previousTime.current = time;
    const c = camera.current;
    if (!drag.current && !reduced.current) {
      c.tx += c.vx * dt;
      c.ty += c.vy * dt;
      const friction = Math.exp(-dt / 160);
      c.vx *= friction;
      c.vy *= friction;
    }
    limit();
    const ease = reduced.current ? 1 : 1 - Math.exp(-dt / 36);
    c.x += (c.tx - c.x) * ease;
    c.y += (c.ty - c.y) * ease;
    paint();
    if (
      Math.abs(c.tx - c.x) + Math.abs(c.ty - c.y) > 0.1 ||
      (!drag.current && Math.abs(c.vx) + Math.abs(c.vy) > 0.01)
    ) {
      frame.current = requestAnimationFrame(tick);
    } else {
      frame.current = 0;
      previousTime.current = 0;
    }
  }
  function move() {
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    previousTime.current = 0;
    const c = camera.current;
    c.tx = c.x;
    c.ty = c.y;
    c.vx = 0;
    c.vy = 0;
  }
  function checkEdge() {
    const c = camera.current,
      b = bounds.current;
    if (
      Math.min(c.tx - b.left, b.right - c.tx, c.ty - b.top, b.bottom - c.ty) <
      80
    )
      edge.current();
  }
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      reduced.current = media.matches;
    };
    change();
    media.addEventListener('change', change);
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      media.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    if (frozen) stop();
  }, [frozen]);
  useEffect(() => {
    limit();
    move();
  }, [size, circles]);
  function reveal(circle: MomentCircle) {
    const c = camera.current,
      radius = circle.radius * scale + 16;
    const x = circle.x * scale + c.tx,
      y = circle.y * scale + c.ty;
    c.vx = 0;
    c.vy = 0;
    if (Math.abs(x) + radius > size.width / 2) c.tx = -circle.x * scale;
    if (Math.abs(y) + radius > size.height / 2) c.ty = -circle.y * scale;
    move();
  }
  function finish(cancelled = false) {
    const gesture = drag.current;
    if (!gesture) return;
    suppressClick.current = gesture.moved;
    if (cancelled || performance.now() - gesture.time > 90 || reduced.current)
      camera.current.vx = camera.current.vy = 0;
    drag.current = null;
    viewport.current?.removeAttribute('data-dragging');
    if (viewport.current?.hasPointerCapture(gesture.id))
      viewport.current.releasePointerCapture(gesture.id);
    if (gesture.moved) {
      checkEdge();
      move();
    }
  }
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- This focusable spatial viewport supports pointer panning and arrow/Home navigation; its items remain native buttons.
    <section
      ref={viewport}
      className="mb-field"
      style={{ '--mb-hover-scale': MOMENT_HOVER_SCALE } as CSSProperties}
      aria-label="Agent 事项画布，可拖动或用方向键浏览，Home 回到中心"
      tabIndex={0}
      onPointerDown={(e) => {
        if (frozen || !e.isPrimary || e.button !== 0) return;
        stop();
        suppressClick.current = false;
        drag.current = {
          id: e.pointerId,
          start: { x: e.clientX, y: e.clientY },
          last: { x: e.clientX, y: e.clientY },
          time: performance.now(),
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const gesture = drag.current;
        if (!gesture || gesture.id !== e.pointerId) return;
        if (
          !gesture.moved &&
          Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) <
            7
        )
          return;
        if (!gesture.moved) {
          gesture.moved = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.setAttribute('data-dragging', '');
        }
        const time = performance.now(),
          dt = Math.max(8, time - gesture.time);
        const dx = e.clientX - gesture.last.x,
          dy = e.clientY - gesture.last.y;
        const c = camera.current;
        c.tx += dx;
        c.ty += dy;
        c.vx = clamp(c.vx * 0.3 + (dx / dt) * 0.7, -2.5, 2.5);
        c.vy = clamp(c.vy * 0.3 + (dy / dt) * 0.7, -2.5, 2.5);
        gesture.last = { x: e.clientX, y: e.clientY };
        gesture.time = time;
        limit();
        move();
      }}
      onPointerUp={() => finish()}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onClickCapture={(e) => {
        if (suppressClick.current && e.detail !== 0) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onKeyDown={(e) => {
        if (
          frozen ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(
            e.key,
          )
        )
          return;
        e.preventDefault();
        const c = camera.current;
        c.vx = 0;
        c.vy = 0;
        if (e.key === 'Home') {
          c.tx = 0;
          c.ty = 0;
        } else {
          c.tx +=
            e.key === 'ArrowLeft' ? 100 : e.key === 'ArrowRight' ? -100 : 0;
          c.ty += e.key === 'ArrowUp' ? 100 : e.key === 'ArrowDown' ? -100 : 0;
        }
        limit();
        checkEdge();
        move();
      }}
    >
      <div ref={world} className="mb-world">
        {circles.map((circle) => {
          const group = groups.find((g) => g.id === circle.id);
          if (!group) return null;
          const diameter = circle.radius * scale * 2;
          return (
            <button
              key={circle.id}
              className="mb-orb"
              type="button"
              style={{
                width: diameter,
                height: diameter,
                transform: `translate3d(${(circle.x - circle.radius) * scale}px, ${(circle.y - circle.radius) * scale}px, 0)`,
              }}
              aria-label={`${group.name}，${group.items.length} 项事项，查看事项`}
              onFocus={(e) => {
                if (e.currentTarget.matches(':focus-visible')) reveal(circle);
              }}
              onClick={(e) => {
                stop();
                onSelect(group.id, e.currentTarget);
              }}
            >
              <span className="mb-orb-image">
                <AgentAvatar agentId={group.id} name={group.name} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
