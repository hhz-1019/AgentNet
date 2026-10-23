import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EntryReadyContext } from '../brand-entry';
import { X } from '../icons';
import './communication-design.css';
import './reading-motion.css';

function compactTransform(origin: DOMRect | undefined, panel: DOMRect) {
  if (!origin) return 'translate3d(0, 18px, 0) scale(0.98)';
  const clamp = (value: number, limit: number) =>
    Math.max(-limit, Math.min(limit, value));
  const x = clamp(origin.x + origin.width / 2 - panel.x - panel.width / 2, 72);
  const y = clamp(
    origin.y + origin.height / 2 - panel.y - panel.height / 2,
    72,
  );
  const scale = Math.max(0.88, Math.min(0.98, origin.width / panel.width));
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}

export function Dialog({
  title,
  onClose,
  children,
  wide = false,
  busy = false,
  origin,
  className = '',
  closeOnBackdrop = false,
  motion = 'compact',
  getOrigin,
  motionArtwork,
  hideTitle = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  busy?: boolean;
  origin?: DOMRect;
  className?: string;
  closeOnBackdrop?: boolean;
  motion?: 'compact' | 'bubble';
  getOrigin?: () => DOMRect | undefined;
  motionArtwork?: ReactNode;
  hideTitle?: boolean;
}) {
  const titleId = useId();
  const entryReady = useContext(EntryReadyContext);
  const ref = useRef<HTMLDialogElement>(null);
  const animation = useRef<Animation | undefined>(undefined);
  const compact = useRef('translate3d(0, 18px, 0) scale(0.98)');
  const initialOrigin = useRef(origin);
  const initialMotion = useRef(motion);
  const initialClose = useRef(onClose);
  const mounted = useRef(false);
  const contentAnimation = useRef<Animation | undefined>(undefined);
  const artworkAnimation = useRef<Animation | undefined>(undefined);
  const bubbleFrames = (el: HTMLDialogElement, rect: DOMRect | undefined) => {
    const panel = el.getBoundingClientRect();
    if (!rect) return { transform: 'scale(0.94)', borderRadius: '24px' };
    const x = rect.x + rect.width / 2 - panel.x - panel.width / 2;
    const y = rect.y + rect.height / 2 - panel.y - panel.height / 2;
    return {
      transform: `translate3d(${x}px, ${y}px, 0) scale(${rect.width / panel.width}, ${rect.height / panel.height})`,
      borderRadius: '50%',
    };
  };
  const closePending = useRef(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!entryReady) return;
    const el = ref.current;
    const motion = initialMotion.current;
    if (!el) return;
    mounted.current = true;
    const previous = document.activeElement;
    el.showModal();
    const initialFocus =
      el.querySelector<HTMLElement>('[data-dialog-autofocus]') || el;
    initialFocus.focus({ preventScroll: true });
    compact.current = compactTransform(
      initialOrigin.current,
      el.getBoundingClientRect(),
    );
    if (
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      typeof el.animate === 'function'
    ) {
      if (motion === 'bubble') {
        animation.current = el.animate(
          [
            bubbleFrames(el, initialOrigin.current),
            {
              transform: 'none',
              borderRadius: getComputedStyle(el).borderRadius,
            },
          ],
          { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
        const artwork = el.querySelector<HTMLElement>('.ew-dialog-artwork');
        if (artwork)
          artworkAnimation.current = artwork.animate(
            [{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }],
            { duration: 520, easing: 'ease-out' },
          );
        const body = el.querySelector<HTMLElement>('.ew-dialog-body');
        if (body)
          contentAnimation.current = body.animate(
            [
              { opacity: 0, offset: 0 },
              { opacity: 0, offset: 0.18 },
              { opacity: 1 },
            ],
            { duration: 480, easing: 'ease-out' },
          );
      } else {
        animation.current = el.animate(
          [{ transform: compact.current }, { transform: 'none' }],
          { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        );
      }
    }
    const onResize = () => {
      if (motion !== 'bubble') return;
      animation.current?.cancel();
      contentAnimation.current?.cancel();
      artworkAnimation.current?.cancel();
      if (closePending.current && mounted.current) initialClose.current();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      mounted.current = false;
      animation.current?.cancel();
      contentAnimation.current?.cancel();
      artworkAnimation.current?.cancel();
      el.close();
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        !document.querySelector('dialog[open]')
      )
        previous.focus({ preventScroll: true });
    };
  }, [entryReady]);
  function requestClose() {
    if (busy || closePending.current) return;
    closePending.current = true;
    const el = ref.current;
    if (
      !el ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof el.animate !== 'function'
    ) {
      onClose();
      return;
    }
    const currentTransform = getComputedStyle(el).transform;
    const currentRadius = getComputedStyle(el).borderRadius;
    animation.current?.cancel();
    setClosing(true);
    const end =
      motion === 'bubble'
        ? bubbleFrames(el, getOrigin?.() || initialOrigin.current)
        : { transform: compact.current };
    if (motion === 'bubble') {
      const artwork = el.querySelector<HTMLElement>('.ew-dialog-artwork');
      artworkAnimation.current?.cancel();
      if (artwork)
        artworkAnimation.current = artwork.animate(
          [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }],
          { duration: 360, easing: 'ease-in', fill: 'forwards' },
        );
      const body = el.querySelector<HTMLElement>('.ew-dialog-body');
      contentAnimation.current?.cancel();
      if (body)
        contentAnimation.current = body.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 140, easing: 'ease-out', fill: 'forwards' },
        );
    }
    animation.current = el.animate(
      [
        {
          transform: currentTransform,
          borderRadius: currentRadius,
        },
        end,
      ],
      {
        duration: motion === 'bubble' ? 360 : 200,
        easing:
          motion === 'bubble'
            ? 'cubic-bezier(0.65, 0, 0.35, 1)'
            : 'cubic-bezier(0.4, 0, 0.7, 1)',
        fill: 'forwards',
      },
    );
    void animation.current.finished
      .then(() => {
        if (mounted.current) onClose();
      })
      .catch(() => {
        /* A route change may unmount the panel before its exit completes. */
      });
  }
  const body = (
    <>
      <div className="sw-dialog-heading">
        <div
          className={
            hideTitle ? 'sn-dialog-title sw-sr-only' : 'sn-dialog-title'
          }
        >
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="ew-paper-button"
          type="button"
          onClick={requestClose}
          disabled={busy || closing}
          aria-label="关闭窗口"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </>
  );
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Native dialog handles Escape via onCancel; pointer clicks outside its bounds dismiss the backdrop.
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`sw-dialog sn-communication-dialog ew-motion-dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}
      data-motion={motion}
      data-closing={closing || undefined}
      inert={closing}
      onClick={(event) => {
        if (!closeOnBackdrop || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          requestClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
    >
      {motion === 'bubble' && motionArtwork && (
        <div className="ew-dialog-artwork" aria-hidden="true">
          {motionArtwork}
        </div>
      )}
      {motion === 'bubble' ? (
        <div className="ew-dialog-body">{body}</div>
      ) : (
        body
      )}
    </dialog>
  );
}
