import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
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
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  busy?: boolean;
  origin?: DOMRect;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const animation = useRef<Animation | undefined>(undefined);
  const compact = useRef('translate3d(0, 18px, 0) scale(0.98)');
  const initialOrigin = useRef(origin);
  const mounted = useRef(false);
  const closePending = useRef(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    mounted.current = true;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    el.showModal();
    compact.current = compactTransform(
      initialOrigin.current,
      el.getBoundingClientRect(),
    );
    if (
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      typeof el.animate === 'function'
    ) {
      animation.current = el.animate(
        [{ transform: compact.current }, { transform: 'none' }],
        { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
    return () => {
      mounted.current = false;
      animation.current?.cancel();
      el.close();
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
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
    animation.current?.cancel();
    setClosing(true);
    animation.current = el.animate(
      [{ transform: currentTransform }, { transform: compact.current }],
      {
        duration: 200,
        easing: 'cubic-bezier(0.4, 0, 0.7, 1)',
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
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`sw-dialog sn-communication-dialog ew-motion-dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}
      data-closing={closing || undefined}
      inert={closing}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
    >
      <div className="sw-dialog-heading">
        <div className="sn-dialog-title">
          <span className="sn-dialog-mark" aria-hidden="true" />
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          onClick={requestClose}
          disabled={busy || closing}
          aria-label="关闭窗口"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
