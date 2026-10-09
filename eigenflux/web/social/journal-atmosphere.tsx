import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Pause, Sun } from 'lucide-react';
import { JOURNAL_WIND_LIFT_PX, sampleJournalWind } from './journal-wind';

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

type Surface = { node: HTMLElement; visible: boolean; lift: number };

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
    const sky = background.current;
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
    }

    function clearSurface(surface: Surface) {
      surface.node.style.removeProperty('--ew-paper-lift');
      surface.node.style.removeProperty('--ew-paper-shadow');
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
        (surface) => surface.node.isConnected && surface.lift > 0,
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
          `${(wind.ambient * 9).toFixed(3)}px`,
        );
        sky.style.setProperty(
          '--ew-wind-y',
          `${(-wind.ambient * 5).toFixed(3)}px`,
        );
        sky.style.setProperty(
          '--ew-wind-turn',
          `${(wind.ambient * 0.65).toFixed(4)}deg`,
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

    const visibility = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const surface = surfaces.get(entry.target as HTMLElement);
          if (surface)
            surface.visible =
              entry.isIntersecting && entry.intersectionRatio >= 0.25;
        }
      },
      { threshold: [0, 0.25] },
    );

    function discover() {
      for (const [node, surface] of surfaces) {
        if (!root.contains(node)) {
          visibility.unobserve(node);
          clearSurface(surface);
          surfaces.delete(node);
        }
      }
      for (const node of root.querySelectorAll<HTMLElement>(surfaceSelector)) {
        if (!surfaces.has(node)) {
          surfaces.set(node, { node, visible: false, lift: 0 });
          visibility.observe(node);
        }
      }
      pair = pair.filter((surface) => surfaces.has(surface.node));
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

export function JournalAtmosphere({
  background,
}: {
  background: RefObject<HTMLDivElement | null>;
}) {
  const id = useId().replaceAll(':', '');
  return (
    <div className="ew-journal-atmosphere" ref={background} aria-hidden="true">
      <div className="ew-paper-grain" />
      <svg
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMin slice"
        focusable="false"
      >
        <defs>
          <filter
            id={`${id}-soft`}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feGaussianBlur stdDeviation="11" />
          </filter>
          <filter
            id={`${id}-leaf`}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <linearGradient id={`${id}-sun`} x1="1" y1="0" x2="0.2" y2="1">
            <stop stopColor="#fffcdf" stopOpacity="0.8" />
            <stop offset="1" stopColor="#ffe5aa" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-shade`} x1="1" y1="0" x2="0.1" y2="1">
            <stop stopColor="#8a805f" stopOpacity="0.15" />
            <stop offset="0.65" stopColor="#a49a7a" stopOpacity="0.09" />
            <stop offset="1" stopColor="#a49a7a" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-canopy`} cx="1" cy="0" r="1">
            <stop stopColor="#716e4a" stopOpacity="0.16" />
            <stop offset="0.7" stopColor="#8b8961" stopOpacity="0.08" />
            <stop offset="1" stopColor="#8b8961" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g
          className="ew-window-light"
          fill={`url(#${id}-sun)`}
          filter={`url(#${id}-soft)`}
        >
          <path d="M 715 -100 H 1225 L 705 940 H 135 Z" />
          <path d="M 1265 -100 H 1775 L 1305 940 H 745 Z" />
        </g>
        <g
          className="ew-window-shadow"
          fill={`url(#${id}-shade)`}
          filter={`url(#${id}-soft)`}
        >
          <path d="M 1220 -80 H 1260 L 730 990 H 690 Z M 550 263 L 1635 263 L 1610 305 L 525 305 Z M 785 -80 H 811 L 260 970 H 234 Z" />
        </g>
        <g
          className="ew-tree-shadow"
          fill={`url(#${id}-canopy)`}
          filter={`url(#${id}-leaf)`}
        >
          <path d="M1510 -70 C1390 60 1480 185 1320 315 C1250 370 1170 465 1130 570 L1140 578 C1200 480 1270 384 1340 326 C1485 200 1410 63 1540 -70Z" />
          <path d="M1500 55 C1460 7 1357 -5 1366 63 C1401 107 1465 94 1500 55Z M1456 133 C1498 51 1570 68 1551 127 C1529 168 1486 157 1456 133Z M1437 179 C1401 101 1310 79 1301 139 C1315 191 1398 215 1437 179Z M1402 241 C1448 158 1528 193 1496 248 C1472 282 1428 273 1402 241Z M1349 306 C1318 222 1234 208 1220 258 C1231 305 1304 331 1349 306Z M1294 363 C1335 285 1428 313 1390 371 C1355 400 1320 388 1294 363Z M1230 431 C1207 362 1138 329 1119 375 C1126 423 1182 450 1230 431Z M1176 505 C1215 448 1280 441 1270 485 C1244 529 1203 532 1176 505Z" />
          <path d="M1220 -20 C1160 35 1170 98 1100 180 C1040 250 1000 293 962 378 L974 379 C1012 305 1058 256 1115 191 C1185 112 1176 42 1240 -20Z M1188 37 C1166 -18 1086 -13 1099 35 C1120 63 1162 61 1188 37Z M1165 99 C1199 33 1260 57 1236 102 C1212 132 1184 120 1165 99Z M1110 169 C1090 102 1021 71 1006 119 C1015 163 1067 181 1110 169Z M1060 233 C1109 172 1164 194 1142 233 C1116 263 1081 252 1060 233Z M1009 302 C987 244 925 229 926 269 C940 301 979 323 1009 302Z" />
        </g>
      </svg>
    </div>
  );
}
