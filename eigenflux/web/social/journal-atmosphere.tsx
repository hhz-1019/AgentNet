import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Pause, Sun } from 'lucide-react';
import {
  JOURNAL_WIND_LIFT_PX,
  paperTiltDegrees,
  sampleJournalWind,
} from './journal-wind';

const preferenceKey = 'elsewhere:journal-motion';
const surfaceSelector = '.sw-feed-grid [data-breeze-surface]';
const editingSelector = 'input, textarea, select, [contenteditable="true"]';

function readPaused() {
  try {
    return localStorage.getItem(preferenceKey) === 'paused';
  } catch {
    return false;
  }
}

type Surface = {
  node: HTMLElement;
  cover: HTMLElement;
  visible: boolean;
  lift: number;
  height: number;
};

/** One active-time clock connects the canopy and two decorative paper edges. */
export function useJournalAtmosphere(
  workspace: RefObject<HTMLDivElement | null>,
  route: string,
  blocked: boolean,
) {
  const background = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(readPaused);
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const settings = useRef({ paused, reduced, route, blocked });
  const update = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    const storage = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null)
        setPaused(readPaused());
    };
    media.addEventListener('change', change);
    window.addEventListener('storage', storage);
    return () => {
      media.removeEventListener('change', change);
      window.removeEventListener('storage', storage);
    };
  }, []);

  useEffect(() => {
    settings.current = { paused, reduced, route, blocked };
    update.current?.();
  }, [paused, reduced, route, blocked]);

  useEffect(() => {
    if (!workspace.current || !background.current) return;
    const root = workspace.current;
    // Root variables reach both the paper backdrop and its translucent light wash.
    const sky = root;
    let frame = 0;
    let previous = 0;
    let elapsed = -2_000;
    let cycle = -1;
    let cursor = 0;
    let resting = true;
    let disposed = false;
    let composing = false;
    let overlay = false;
    let selection = false;
    let pointer: Element | null = null;
    let currentRoute = settings.current.route;
    const surfaces = new Map<HTMLElement, Surface>();
    let pair: Surface[] = [];

    function writeSurface(surface: Surface) {
      surface.node.style.setProperty(
        '--ew-paper-lift',
        `${surface.lift.toFixed(3)}px`,
      );
      surface.node.style.setProperty(
        '--ew-paper-shadow',
        (surface.lift / JOURNAL_WIND_LIFT_PX).toFixed(4),
      );
      surface.node.style.setProperty(
        '--ew-paper-tilt',
        `${paperTiltDegrees(surface.lift, surface.height).toFixed(5)}deg`,
      );
    }

    function clearSurface(surface: Surface) {
      surface.node.style.removeProperty('--ew-paper-lift');
      surface.node.style.removeProperty('--ew-paper-shadow');
      surface.node.style.removeProperty('--ew-paper-tilt');
      delete surface.node.dataset.breezeRest;
    }

    function reset() {
      elapsed = -2_000;
      cycle = -1;
      pair = [];
      sky.style.removeProperty('--ew-wind-x');
      sky.style.removeProperty('--ew-wind-y');
      sky.style.removeProperty('--ew-wind-turn');
      sky.style.removeProperty('--ew-sun-strength');
      for (const surface of surfaces.values()) {
        surface.lift = 0;
        clearSurface(surface);
      }
    }

    function held(surface: Surface) {
      return (
        surface.node.contains(pointer) ||
        surface.node.contains(document.activeElement)
      );
    }

    function choosePair() {
      // A held, raised edge keeps its slot until it can settle. Never start a
      // third region while a reader is keeping one of the previous pair still.
      pair = pair.filter(
        (surface) => surfaces.get(surface.node) === surface && surface.lift > 0,
      );
      const available = Array.from(surfaces.values()).filter(
        (surface) =>
          surface.visible && !held(surface) && !pair.includes(surface),
      );
      const start = available.length ? cursor % available.length : 0;
      for (let index = 0; index < available.length && pair.length < 2; index++)
        pair.push(available[(start + index) % available.length]);
      cursor++;
    }

    function tick(now: number) {
      frame = 0;
      if (resting || disposed) return;
      if (!previous) previous = now;
      const delta = now - previous;
      if (delta >= 32) {
        previous = now;
        // A stalled frame must not fast-forward the breeze after a busy task.
        const step = Math.min(delta, 64);
        elapsed += step;
        const wind = sampleJournalWind(elapsed);
        if (elapsed >= 0 && cycle !== wind.cycle) {
          cycle = wind.cycle;
          choosePair();
        }
        sky.style.setProperty(
          '--ew-wind-x',
          `${(wind.ambient * 18).toFixed(3)}px`,
        );
        sky.style.setProperty(
          '--ew-wind-y',
          `${(-wind.ambient * 10).toFixed(3)}px`,
        );
        sky.style.setProperty(
          '--ew-wind-turn',
          `${(wind.ambient * 0.85).toFixed(4)}deg`,
        );
        sky.style.setProperty('--ew-sun-strength', wind.ambient.toFixed(4));
        for (const surface of pair) {
          if (held(surface)) continue;
          const strength =
            pair.indexOf(surface) === 0 ? wind.gust : wind.secondary;
          const target = surface.visible ? strength * JOURNAL_WIND_LIFT_PX : 0;
          // Smoothly rejoin the common wind after hovering; never snap to phase.
          surface.lift += (target - surface.lift) * (1 - Math.exp(-step / 220));
          if (target === 0 && surface.lift < 0.001) surface.lift = 0;
          writeSurface(surface);
        }
      }
      frame = requestAnimationFrame(tick);
    }

    function sync() {
      const state = settings.current;
      if (currentRoute !== state.route) {
        currentRoute = state.route;
        reset();
      }
      const reading =
        ['explore', 'me', 'liked', 'saved', 'network'].includes(state.route) ||
        state.route.startsWith('person/');
      resting =
        state.paused ||
        state.reduced ||
        state.blocked ||
        !reading ||
        document.hidden ||
        overlay ||
        selection ||
        composing ||
        Boolean(document.activeElement?.matches(editingSelector));
      root.dataset.atmospherePaused = String(resting);
      root.dataset.atmosphereReduced = String(state.reduced);
      for (const surface of surfaces.values())
        surface.node.dataset.breezeRest = String(resting || held(surface));
      if (resting) {
        cancelAnimationFrame(frame);
        frame = 0;
        previous = 0;
        if (state.reduced) reset();
      } else if (!frame) {
        previous = 0;
        frame = requestAnimationFrame(tick);
      }
    }

    const coverSizes = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const surface = Array.from(surfaces.values()).find(
          (item) => item.cover === entry.target,
        );
        const height =
          entry.borderBoxSize[0]?.blockSize ??
          (entry.target as HTMLElement).offsetHeight;
        if (surface && surface.cover.isConnected && height > 0) {
          surface.height = height;
          writeSurface(surface);
        }
      }
    });
    const visibility = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const surface = Array.from(surfaces.values()).find(
            (item) => item.cover === entry.target,
          );
          if (surface)
            surface.visible =
              entry.isIntersecting && entry.intersectionRatio >= 0.25;
        }
      },
      { threshold: [0, 0.25] },
    );

    function discover() {
      for (const [node, surface] of surfaces) {
        if (
          !root.contains(node) ||
          !node.matches(surfaceSelector) ||
          node.querySelector('.sw-post-media, .sw-text-cover') !== surface.cover
        ) {
          visibility.unobserve(surface.cover);
          coverSizes.unobserve(surface.cover);
          clearSurface(surface);
          surfaces.delete(node);
        }
      }
      for (const node of root.querySelectorAll<HTMLElement>(surfaceSelector)) {
        if (!surfaces.has(node)) {
          const cover = node.querySelector<HTMLElement>(
            '.sw-post-media, .sw-text-cover',
          );
          if (!cover) continue;
          surfaces.set(node, {
            node,
            cover,
            visible: false,
            lift: 0,
            height: cover.offsetHeight || 240,
          });
          visibility.observe(cover);
          coverSizes.observe(cover);
        }
      }
      pair = pair.filter((surface) => surfaces.get(surface.node) === surface);
      overlay = Boolean(
        document.querySelector('dialog[open], .ew-brand-entry'),
      );
      select();
    }

    function point(event: PointerEvent) {
      pointer =
        event.type === 'pointerout'
          ? (event.relatedTarget as Element | null)
          : (event.target as Element | null);
      sync();
    }
    function select() {
      const range = document.getSelection();
      selection = false;
      if (range && !range.isCollapsed)
        for (let index = 0; index < range.rangeCount; index++)
          selection ||= range.getRangeAt(index).intersectsNode(root);
      sync();
    }
    function compose(event: CompositionEvent) {
      composing = event.type === 'compositionstart';
      sync();
    }
    const mutations = new MutationObserver(discover);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    root.addEventListener('pointerover', point);
    root.addEventListener('pointerout', point);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    document.addEventListener('selectionchange', select);
    document.addEventListener('visibilitychange', sync);
    document.addEventListener('compositionstart', compose);
    document.addEventListener('compositionend', compose);
    update.current = sync;
    discover();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      visibility.disconnect();
      coverSizes.disconnect();
      mutations.disconnect();
      root.removeEventListener('pointerover', point);
      root.removeEventListener('pointerout', point);
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
      document.removeEventListener('selectionchange', select);
      document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('compositionstart', compose);
      document.removeEventListener('compositionend', compose);
      for (const surface of surfaces.values()) clearSurface(surface);
      delete root.dataset.atmospherePaused;
      delete root.dataset.atmosphereReduced;
      sky.style.removeProperty('--ew-wind-x');
      sky.style.removeProperty('--ew-wind-y');
      sky.style.removeProperty('--ew-wind-turn');
      sky.style.removeProperty('--ew-sun-strength');
      update.current = undefined;
    };
  }, [workspace]);

  function toggle() {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(preferenceKey, next ? 'paused' : 'playing');
    } catch {
      // The current session can still pause when browser storage is unavailable.
    }
  }

  return { background, paused, reduced, toggle };
}

export function AtmosphereToggle({
  paused,
  reduced,
  toggle,
}: Pick<
  ReturnType<typeof useJournalAtmosphere>,
  'paused' | 'reduced' | 'toggle'
>) {
  return (
    <button
      type="button"
      className="ew-atmosphere-toggle"
      onClick={toggle}
      disabled={reduced}
      aria-pressed={!paused && !reduced}
      aria-label={reduced ? '光影动态：已跟随系统减少动态' : '光影动态'}
      title={reduced ? '已跟随系统的减少动态设置' : undefined}
    >
      {paused || reduced ? (
        <Sun size={17} aria-hidden="true" />
      ) : (
        <Pause size={16} aria-hidden="true" />
      )}
      <span>{reduced ? '静态光影' : paused ? '开启光影' : '暂停光影'}</span>
    </button>
  );
}

function Canopy() {
  return (
    <div className="ew-tree-shadow">
      <div className="ew-canopy-near" />
      <div className="ew-canopy-far" />
    </div>
  );
}

export function JournalAtmosphere({
  background,
}: {
  background: RefObject<HTMLDivElement | null>;
}) {
  const id = useId().replaceAll(':', '');
  return (
    <>
      <div
        className="ew-journal-atmosphere"
        ref={background}
        aria-hidden="true"
      >
        <div className="ew-paper-grain" />
        <svg
          className="ew-window-projection"
          viewBox="0 0 1600 1000"
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <filter
              id={id + '-window'}
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
            >
              <feGaussianBlur stdDeviation="14" />
            </filter>
            <linearGradient id={id + '-daylight'} x1="0" y1="0" x2="0.9" y2="1">
              <stop stopColor="#fff9df" stopOpacity="0.44" />
              <stop offset="1" stopColor="#fff9df" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            className="ew-window-light"
            fill={'url(#' + id + '-daylight)'}
            d="M -180 0 H 440 L 1115 1000 H 440 Z M 500 0 H 1100 L 1775 1000 H 1175 Z"
          />
          <g
            className="ew-window-shadow"
            fill="#655b47"
            filter={'url(#' + id + '-window)'}
          >
            <path d="M 412 -100 L 1160 1100 H 1217 L 469 -100 Z M 1048 -100 L 1796 1100 H 1840 L 1092 -100 Z M -70 660 L 1700 190 L 1700 230 L -70 700 Z" />
          </g>
        </svg>
        <Canopy />
      </div>
      <div className="ew-journal-light-wash" aria-hidden="true">
        <Canopy />
      </div>
    </>
  );
}
