export const JOURNAL_WIND_CYCLE_MS = 20_000;
export const JOURNAL_WIND_LIFT_PX = 3;

/** A sheet is hinged along its top edge: the bottom rises in depth, never drifts. */
export function paperTiltDegrees(lift: number, height: number) {
  if (!Number.isFinite(lift) || !Number.isFinite(height) || height <= 0)
    return 0;
  const rise = Math.max(0, Math.min(lift, JOURNAL_WIND_LIFT_PX, height));
  return (Math.asin(rise / height) * 180) / Math.PI;
}

const riseMs = 2_000;
const settleMs = 6_000;
const followDelayMs = 700;
const followStrength = 0.72;

export type JournalWind = {
  /** Select new paper regions only when this changes, during the still interval. */
  cycle: number;
  /** Shared canopy response; all strengths are normalized to 0..1. */
  ambient: number;
  gust: number;
  secondary: number;
};

function ease(value: number) {
  // Zero velocity and acceleration at either end prevent a mechanical reversal.
  return Math.max(
    0,
    Math.min(1, value ** 3 * (10 + value * (-15 + 6 * value))),
  );
}

function pulse(elapsedMs: number) {
  if (elapsedMs <= 0 || elapsedMs >= riseMs + settleMs) return 0;
  if (elapsedMs < riseMs) return ease(elapsedMs / riseMs);
  return 1 - ease((elapsedMs - riseMs) / settleMs);
}

/**
 * Sample a shared active-time clock; no timers, randomness, or accumulated state.
 * The caller pauses that clock when hidden or when motion is suspended.
 * A gust rises for 2 s, settles for 6 s, and reaches the second region 0.7 s later.
 * Both regions and the canopy are exactly still from 8.7 s until the next cycle.
 * Paper lift is strength * JOURNAL_WIND_LIFT_PX; never move the readable content.
 */
export function sampleJournalWind(elapsedMs: number): JournalWind {
  const time = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const cycle = Math.floor(time / JOURNAL_WIND_CYCLE_MS);
  const phase = time % JOURNAL_WIND_CYCLE_MS;
  const gust = pulse(phase);
  const secondary = followStrength * pulse(phase - followDelayMs);
  return {
    cycle,
    ambient: (gust + secondary) / (1 + followStrength),
    gust,
    secondary,
  };
}
