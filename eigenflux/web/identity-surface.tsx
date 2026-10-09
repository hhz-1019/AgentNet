import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import './identity-card.css';

/** The original identity card's pointer tilt, shared by private and public views. */
export function IdentitySurface({
  children,
  engraved = false,
}: {
  children: ReactNode;
  engraved?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const reset = () => {
    cancelAnimationFrame(frame.current);
    surface.current?.removeAttribute('style');
  };
  useEffect(() => {
    const preference = matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    );
    preference.addEventListener('change', reset);
    return () => {
      cancelAnimationFrame(frame.current);
      preference.removeEventListener('change', reset);
    };
  }, []);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== 'mouse' ||
      !matchMedia(
        '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
      ).matches
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    );
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const style = surface.current?.style;
      if (!style) return;
      style.setProperty('--rx', `${(0.5 - y) * 9}deg`);
      style.setProperty('--ry', `${(x - 0.5) * 11}deg`);
      style.setProperty('--px', `${x * 100}%`);
      style.setProperty('--py', `${y * 100}%`);
      style.setProperty('--sheen', '1');
    });
  };
  return (
    <div
      className={`identity-stage${engraved ? ' identity-stage-engraved' : ''}`}
      onPointerMove={move}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      <div className="identity-surface" ref={surface}>
        {children}
        {engraved && (
          <div className="identity-guilloche" aria-hidden="true">
            <svg viewBox="0 0 360 420" fill="none">
              {Array.from({ length: 15 }, (_, i) => (
                <ellipse
                  key={i}
                  cx="180"
                  cy="210"
                  rx={44 + i * 8}
                  ry={92 + i * 6}
                  transform={`rotate(${i * 7 - 49} 180 210)`}
                />
              ))}
              <circle cx="180" cy="210" r="5" />
            </svg>
          </div>
        )}
        <div className="identity-sheen" aria-hidden="true" />
      </div>
    </div>
  );
}
