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
  projectMoment,
  unprojectMoment,
  momentViewportScale,
  momentRepulsion,
  MOMENT_HOVER_SCALE,
  type MomentCircle,
} from './moment-layout';

/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The spatial viewport is focusable so keyboard users can pan with arrows and Home, just like a scroll region. */

type Group = {
  id: string;
  name: string;
  priority: number;
  own?: boolean;
  items: unknown[];
  messages?: unknown[];
};
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
  const orbs = useRef(new Map<string, HTMLButtonElement>());
  const faces = useRef(new Map<string, HTMLSpanElement>());
  const pointer = useRef<Point | null>(null);
  const [size, setSize] = useState({ width: 800, height: 700 });
  const [packed, setCircles] = useState(() => packMoments(groups));
  const aspect = Math.round((size.width / Math.max(1, size.height)) * 10) / 10;
  const circles = packed;
  const signature = JSON.stringify(
    groups.map((g) => [g.id, g.priority, g.own]),
  );
  useEffect(() => {
    if (!frozen)
      setCircles(
        packMoments(
          JSON.parse(signature).map(
            ([id, priority, own]: [string, number, boolean]) => ({
              id,
              priority,
              own,
            }),
          ),
          aspect,
        ),
      );
  }, [signature, frozen, aspect]);
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
  const geometry = useRef({ size, circles, scale, frozen });
  geometry.current = { size, circles, scale, frozen };
  function paintRepulsion() {
    const c = camera.current,
      g = geometry.current;
    const screenScale = g.scale * c.zoom;
    const offsets = momentRepulsion(
      g.circles.map((circle) =>
        projectMoment(
          {
            id: circle.id,
            x: circle.x * screenScale + c.x,
            y: circle.y * screenScale + c.y,
            radius: circle.radius * screenScale,
          },
          g.size.width,
          g.size.height,
        ),
      ),
      reduced.current || drag.current || g.frozen ? null : pointer.current,
    );
    for (const offset of offsets) {
      const face = faces.current.get(offset.id);
      if (!face) continue;
      face.style.setProperty('--mb-drift-x', `${offset.x}px`);
      face.style.setProperty('--mb-drift-y', `${offset.y}px`);
    }
  }
  function updateBounds() {
    const { size, circles, scale: baseScale } = geometry.current;
    const scale = baseScale * camera.current.targetZoom;
    bounds.current = {
      left:
        -Math.max(0, ...circles.map((c) => c.x * scale)) - size.width * 0.12,
      right:
        -Math.min(0, ...circles.map((c) => c.x * scale)) + size.width * 0.12,
      top:
        -Math.max(0, ...circles.map((c) => c.y * scale)) - size.height * 0.12,
      bottom:
        -Math.min(0, ...circles.map((c) => c.y * scale)) + size.height * 0.12,
    };
  }
  function paint() {
    const c = camera.current,
      g = geometry.current;
    for (const circle of g.circles) {
      const orb = orbs.current.get(circle.id);
      if (!orb) continue;
      const projected = projectMoment(
        {
          ...circle,
          x: circle.x * g.scale * c.zoom + c.x,
          y: circle.y * g.scale * c.zoom + c.y,
          radius: circle.radius * g.scale * c.zoom,
        },
        g.size.width,
        g.size.height,
      );
      orb.style.width = orb.style.height = projected.radius * 2 + 'px';
      orb.style.transform = `translate3d(${projected.x - projected.radius}px, ${projected.y - projected.radius}px, 0)`;
    }
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
    paintRepulsion();
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
    pointer.current = null;
    const c = camera.current;
    const next = zoomMoment(
      { x: c.tx, y: c.ty, zoom: c.targetZoom },
      value,
      unprojectMoment(anchor, size.width, size.height),
      unprojectMoment(destination, size.width, size.height),
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
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandler.current = (event: WheelEvent) => {
    if (frozen) return;
    event.preventDefault();
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
    if (!event.ctrlKey) {
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      camera.current.tx -= event.deltaX * unit;
      camera.current.ty -= event.deltaY * unit;
      camera.current.vx = camera.current.vy = 0;
      pointer.current = null;
      limit();
      move();
      checkEdge();
      return;
    }
    zoomAt(
      camera.current.targetZoom * Math.exp(-clamp(delta, -200, 200) * 0.008),
      localPoint({ x: event.clientX, y: event.clientY }),
    );
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => wheelHandler.current(event);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
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
      if (media.matches) {
        pointer.current = null;
        paintRepulsion();
      }
    };
    change();
    media.addEventListener('change', change);
    const hidden = () => {
      if (document.hidden) {
        stop();
        pointer.current = null;
        paintRepulsion();
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      media.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    if (frozen) {
      stop();
      pointer.current = null;
      paintRepulsion();
    }
  }, [frozen]);
  useLayoutEffect(() => {
    limit();
    paint();
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
  function finish() {
    const gesture = drag.current;
    if (!gesture) return;
    suppressClick.current = gesture.moved;
    // Release where the user placed the surface; do not coast past their focus.
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
  function endPointer(id: number) {
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
    if (drag.current?.id === id) finish();
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
        pointer.current = null;
        paintRepulsion();
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
        if (e.pointerType === 'mouse' && !drag.current && !frozen) {
          pointer.current = localPoint({ x: e.clientX, y: e.clientY });
          move();
        }
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
        const before = unprojectMoment(
          localPoint(gesture.last),
          size.width,
          size.height,
        );
        const after = unprojectMoment(
          localPoint({ x: e.clientX, y: e.clientY }),
          size.width,
          size.height,
        );
        const dx = after.x - before.x,
          dy = after.y - before.y;
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
      onPointerLeave={() => {
        pointer.current = null;
        move();
      }}
      onPointerCancel={(e) => endPointer(e.pointerId)}
      onLostPointerCapture={(e) => {
        // Ignore bubbling capture transfers from the touched avatar to the
        // canvas; those are part of starting a drag or pinch, not cancellation.
        if (
          e.target === e.currentTarget &&
          !e.currentTarget.hasPointerCapture(e.pointerId)
        )
          endPointer(e.pointerId);
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
        <div className="mb-world">
          {circles.map((circle) => {
            const group = groups.find((g) => g.id === circle.id);
            if (!group) return null;
            const diameter = circle.radius * scale * 2;
            return (
              <button
                key={circle.id}
                ref={(node) => {
                  if (node) orbs.current.set(circle.id, node);
                  else orbs.current.delete(circle.id);
                }}
                className="mb-orb"
                type="button"
                style={{
                  width: diameter,
                  height: diameter,
                  transform: `translate3d(${(circle.x - circle.radius) * scale}px, ${(circle.y - circle.radius) * scale}px, 0)`,
                }}
                aria-label={
                  group.messages?.length
                    ? `${group.name}，${group.messages.length} 条交互${group.items.length ? `，${group.items.length} 项事项` : ''}，查看内容`
                    : group.own && !group.items.length
                      ? '你的 Agent，查看近况'
                      : `${group.name}，${group.items.length} 项事项，查看事项`
                }
                onFocus={(e) => {
                  if (e.currentTarget.matches(':focus-visible')) reveal(circle);
                }}
                onClick={(e) => {
                  stop();
                  onSelect(group.id, e.currentTarget);
                }}
              >
                <span
                  className="mb-orb-image"
                  ref={(node) => {
                    if (node) faces.current.set(circle.id, node);
                    else faces.current.delete(circle.id);
                  }}
                >
                  <span className="mb-avatar-fallback" aria-hidden="true">
                    {group.name === '你的 Agent'
                      ? '你'
                      : Array.from(group.name).slice(0, 1).join('')}
                  </span>
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
