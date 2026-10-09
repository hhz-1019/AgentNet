import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  entryGeometry,
  entryTiming,
  clampEntry,
  paintEntry,
  type EntryPhase,
} from './brand-entry-geometry';
import './brand-entry.css';

const storageKey = 'elsewhere:entry-seen:v1';
let enteredThisDocument = false;

function shouldEnter() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return false;
  if (
    import.meta.env.DEV &&
    location.pathname.startsWith('/preview') &&
    new URLSearchParams(location.search).get('entry') === 'replay'
  )
    return true;
  if (enteredThisDocument) return false;
  try {
    return sessionStorage.getItem(storageKey) !== 'yes';
  } catch {
    return true;
  }
}

/** A curtain around the existing app, never a substitute for its loading/error UI. */
export function BrandEntry({
  children,
  ready,
  failed,
}: {
  children: ReactNode;
  ready: boolean;
  failed: boolean;
}) {
  const [active, setActive] = useState(shouldEnter);
  const [resources, setResources] = useState({ fonts: false, logo: false });
  const [resourceFailed, setResourceFailed] = useState(false);
  const [phase, setPhase] = useState<EntryPhase>('loading');
  const content = useRef<HTMLDivElement>(null);
  const curtain = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const prepared = useRef({ ready, failed, resources, resourceFailed, phase });
  prepared.current = { ready, failed, resources, resourceFailed, phase };

  useEffect(() => {
    if (!active) return;
    enteredThisDocument = true;
    try {
      sessionStorage.setItem(storageKey, 'yes');
    } catch {
      /* In-memory guard still works. */
    }
    let disposed = false;
    const complete = (task: keyof typeof resources) => {
      if (!disposed)
        setResources((current) =>
          current[task] ? current : { ...current, [task]: true },
        );
    };
    const failure = () => {
      if (!disposed) setResourceFailed(true);
    };
    // Count actual settled preparation tasks, never elapsed time or guessed bytes.
    void document.fonts.ready.then(() => complete('fonts'), failure);
    const logo = new Image();
    logo.onload = () => complete('logo');
    logo.onerror = failure;
    logo.src = '/brand/wordmark.svg';
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduce = () => {
      if (media.matches) setActive(false);
    };
    media.addEventListener('change', reduce);
    // A stalled optional resource must not hide the app's real connection/retry UI.
    const maximumWait = window.setTimeout(() => {
      if (prepared.current.phase === 'loading') setActive(false);
    }, 8000);
    return () => {
      disposed = true;
      logo.onload = null;
      logo.onerror = null;
      clearTimeout(maximumWait);
      media.removeEventListener('change', reduce);
    };
  }, [active]);

  useLayoutEffect(() => {
    if (!active || !content.current || !curtain.current) return;
    const page = content.current,
      overlay = curtain.current;
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const { scrollX, scrollY } = window;
    const wasInert = page.inert,
      wasHidden = page.getAttribute('aria-hidden');
    const htmlOverflow = document.documentElement.style.overflow,
      bodyOverflow = document.body.style.overflow;
    page.inert = true;
    page.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    overlay.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setActive(false);
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        overlay
          .querySelector<HTMLButtonElement>('button')
          ?.focus({ preventScroll: true });
      }
    };
    overlay.addEventListener('keydown', onKey);
    return () => {
      page.inert = wasInert;
      if (wasHidden === null) page.removeAttribute('aria-hidden');
      else page.setAttribute('aria-hidden', wasHidden);
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
      overlay.removeEventListener('keydown', onKey);
      // Do not steal focus if a real dialog/error has already taken it.
      if (
        document.activeElement === document.body ||
        overlay.contains(document.activeElement)
      ) {
        if (focused?.isConnected && focused !== document.body)
          focused.focus({ preventScroll: true });
      }
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    };
  }, [active]);

  useEffect(() => {
    if (!active || !canvas.current) return;
    const element = canvas.current,
      context = element.getContext('2d');
    if (!context) {
      setActive(false);
      return;
    }
    let width = 1,
      height = 1,
      dpr = 1,
      geometry = entryGeometry(1);
    let frame = 0,
      previous = 0,
      displayed = 0,
      time = 0;
    let currentPhase: EntryPhase = 'loading';
    let alive = true;
    const resize = () => {
      width = Math.max(1, innerWidth);
      height = Math.max(1, innerHeight);
      dpr = Math.min(devicePixelRatio || 1, 2);
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      geometry = entryGeometry(width);
      paintEntry(
        context,
        geometry,
        width,
        height,
        dpr,
        currentPhase,
        displayed,
        time,
      );
    };
    const tick = (now: number) => {
      if (!alive) return;
      const state = prepared.current;
      if (state.failed || state.resourceFailed) {
        setActive(false);
        return;
      }
      const delta = previous ? Math.min(64, now - previous) : 0;
      previous = now;
      if (currentPhase === 'loading') {
        const actual =
          (Number(state.resources.fonts) +
            Number(state.resources.logo) +
            Number(state.ready)) /
          3;
        // Ease only toward already completed work; no timer advances real progress.
        displayed = Math.max(
          displayed,
          clampEntry(
            displayed + (actual - displayed) * (1 - Math.exp(-delta / 120)),
          ),
        );
        if (actual === 1 && displayed > 0.998) {
          displayed = 1;
          currentPhase = 'morph';
          time = 0;
          setPhase(currentPhase);
        }
      } else {
        time += delta;
        if (currentPhase === 'morph' && time >= entryTiming.morph) {
          currentPhase = 'reveal';
          time = 0;
          setPhase(currentPhase);
        } else if (currentPhase === 'reveal' && time >= entryTiming.reveal) {
          setActive(false);
          return;
        }
      }
      paintEntry(
        context,
        geometry,
        width,
        height,
        dpr,
        currentPhase,
        displayed,
        time,
      );
      frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!document.hidden) frame = requestAnimationFrame(tick);
    };
    resize();
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element.width, element.height);
    };
  }, [active]);

  const completed =
    Number(resources.fonts) + Number(resources.logo) + Number(ready);
  return (
    <>
      <div className="ew-entry-content" ref={content}>
        {children}
      </div>
      {active && (
        <dialog
          className="ew-brand-entry"
          ref={curtain}
          open
          tabIndex={-1}
          aria-modal="true"
          aria-label="进入 elsewhere"
          data-entry-phase={phase}
          data-entry-completed={completed}
        >
          <canvas ref={canvas} aria-hidden="true" />
          <div className="ew-entry-status">
            <progress
              className="ew-entry-progress"
              aria-label="页面准备"
              max={3}
              value={completed}
              aria-valuetext={
                phase === 'loading'
                  ? `已完成 ${completed} 项，共 3 项`
                  : '页面已准备好'
              }
            />
            <span>{phase === 'loading' ? '正在准备页面' : 'elsewhere'}</span>
          </div>
          <button
            type="button"
            className="ew-entry-skip"
            onClick={() => setActive(false)}
          >
            跳过动画
          </button>
        </dialog>
      )}
    </>
  );
}
