import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { AgentAvatar } from '../avatar';
import { zoomMoment } from './moment-zoom';
import {
  packMoments,
  momentViewportScale,
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
  const scale = momentViewportScale(circles, size.width, size.height);
  const camera = useRef({
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    vx: 0,
    vy: 0,
    zoom: 1,
    targetZoom: 1,
  });
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ center: Point; distance: number } | null>(null);
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
  const geometry = useRef({ size, circles, scale });
  geometry.current = { size, circles, scale };
  function updateBounds() {
    const { size, circles, scale: baseScale } = geometry.current;
    const scale = baseScale * camera.current.targetZoom;
    bounds.current = {
      left: Math.min(
        -size.width * 0.22,
        size.width / 2 -
          Math.max(...circles.map((c) => (c.x + c.radius) * scale)) -
          64,
      ),
      right: Math.max(
        size.width * 0.22,
        -size.width / 2 -
          Math.min(...circles.map((c) => (c.x - c.radius) * scale)) +
          64,
      ),
      top: Math.min(
        -size.height * 0.22,
        size.height / 2 -
          Math.max(...circles.map((c) => (c.y + c.radius) * scale)) -
          64,
      ),
      bottom: Math.max(
        size.height * 0.22,
        -size.height / 2 -
          Math.min(...circles.map((c) => (c.y - c.radius) * scale)) +
          64,
      ),
    };
  }
  function paint() {
    if (world.current)
      world.current.style.transform = `translate3d(${camera.current.x}px, ${camera.current.y}px, 0) scale(${camera.current.zoom})`;
  }
  function limit() {
    updateBounds();
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
    c.zoom += (c.targetZoom - c.zoom) * ease;
    paint();
    if (
      Math.abs(c.tx - c.x) + Math.abs(c.ty - c.y) > 0.1 ||
      Math.abs(c.targetZoom - c.zoom) > 0.0001 ||
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
    c.targetZoom = c.zoom;
    c.vx = 0;
    c.vy = 0;
  }
  function zoomAt(value: number, anchor: Point, destination = anchor) {
    const c = camera.current;
    const next = zoomMoment(
      { x: c.tx, y: c.ty, zoom: c.targetZoom },
      value,
      anchor,
      destination,
    );
    c.tx = next.x;
    c.ty = next.y;
    c.targetZoom = next.zoom;
    c.vx = c.vy = 0;
    limit();
    move();
  }
  function localPoint(point: Point): Point {
    const rect = viewport.current!.getBoundingClientRect();
    return {
      x: point.x - rect.left - rect.width / 2,
      y: point.y - rect.top - rect.height / 2,
    };
  }
  function pinchPoints() {
    const [a, b] = [...touches.current.values()];
    return {
      center: localPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }
  // Chromium trackpads deliver pinch as Ctrl+wheel. A native non-passive
  // listener keeps this gesture inside the canvas, not the entire browser UI.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (frozen || !event.ctrlKey) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      zoomAt(
        camera.current.targetZoom * Math.exp(-clamp(delta, -200, 200) * 0.008),
        localPoint({ x: event.clientX, y: event.clientY }),
      );
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [frozen, size]);
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
    const scale = geometry.current.scale * camera.current.targetZoom;
    const c = camera.current,
      radius = circle.radius * scale + 64;
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
  function endPointer(id: number, cancelled = false) {
    if (!touches.current.has(id) && drag.current?.id !== id) return;
    touches.current.delete(id);
    if (pinch.current) {
      pinch.current = null;
      suppressClick.current = true;
      const remaining = [...touches.current.entries()][0];
      drag.current = remaining
        ? {
            id: remaining[0],
            start: remaining[1],
            last: remaining[1],
            time: performance.now(),
            moved: true,
          }
        : null;
      if (!remaining) viewport.current?.removeAttribute('data-dragging');
      if (viewport.current?.hasPointerCapture(id))
        viewport.current.releasePointerCapture(id);
      return;
    }
    if (drag.current?.id === id) finish(cancelled);
  }
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- This focusable spatial viewport supports pointer panning and arrow/Home navigation; its items remain native buttons.
    <section
      ref={viewport}
      className="mb-field"
      style={{ '--mb-hover-scale': MOMENT_HOVER_SCALE } as CSSProperties}
      aria-label="Agent 事项画布，可拖动、双指缩放或用方向键浏览，加减号缩放，Home 复位"
      tabIndex={0}
      onPointerDown={(e) => {
        if (
          frozen ||
          e.button !== 0 ||
          (e.pointerType !== 'touch' && !e.isPrimary)
        )
          return;
        if (e.pointerType === 'touch') {
          if (touches.current.size >= 2) return;
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.current.size === 2) {
            stop();
            pinch.current = pinchPoints();
            drag.current = null;
            suppressClick.current = true;
            e.currentTarget.setAttribute('data-dragging', '');
            for (const id of touches.current.keys())
              e.currentTarget.setPointerCapture(id);
            return;
          }
        }
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
        if (touches.current.has(e.pointerId)) {
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current) {
            const next = pinchPoints();
            zoomAt(
              (camera.current.targetZoom * next.distance) /
                pinch.current.distance,
              pinch.current.center,
              next.center,
            );
            pinch.current = next;
            return;
          }
        }
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
      onPointerUp={(e) => endPointer(e.pointerId)}
      onPointerCancel={(e) => endPointer(e.pointerId, true)}
      onLostPointerCapture={(e) => {
        // Ignore bubbling capture transfers from the touched avatar to the
        // canvas; those are part of starting a drag or pinch, not cancellation.
        if (
          e.target === e.currentTarget &&
          !e.currentTarget.hasPointerCapture(e.pointerId)
        )
          endPointer(e.pointerId, true);
      }}
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
          ![
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            '+',
            '=',
            '-',
          ].includes(e.key)
        )
          return;
        e.preventDefault();
        const c = camera.current;
        c.vx = 0;
        c.vy = 0;
        if (['+', '=', '-'].includes(e.key)) {
          zoomAt(c.targetZoom * (e.key === '-' ? 1 / 1.15 : 1.15), {
            x: 0,
            y: 0,
          });
          return;
        }
        if (e.key === 'Home') {
          c.tx = 0;
          c.ty = 0;
          c.targetZoom = 1;
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
      <div className="mb-field-clip">
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
      </div>
    </section>
  );
}
