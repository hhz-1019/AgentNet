// The percentage is an entry-animation estimate, not a count of equal-sized
// downloads. Only real readiness can complete it and open the curtain.
export const entryDeadline = 8000;
export const entryTransition = 2100;
export const entryCompleteHold = 180;
export function entryProgressTarget(
  elapsed: number,
  estimate: number,
  ready: boolean,
) {
  if (ready) return 1;
  // Keep moving while data arrives, without a fixed 33%/66% resource plateau
  // or false completion. The deadline hands prolonged waits to the real UI.
  return (
    0.985 * -Math.expm1(-Math.max(0, elapsed) / (entryEstimate(estimate) * 0.7))
  );
}

export function advanceEntryProgress(
  value: number,
  target: number,
  delta: number,
) {
  return Math.max(value, Math.min(target, value + Math.max(0, delta) / 600));
}
export function entryCanReveal(ready: boolean, progress: number, held: number) {
  return ready && progress === 1 && held >= entryCompleteHold;
}
export function entryEstimate(value: number) {
  return Number.isFinite(value) && value > 0
    ? Math.max(entryTransition, Math.min(5000, value))
    : 3000;
}
export function entryShouldMorph(
  elapsed: number,
  estimate: number,
  ready: boolean,
) {
  return ready || elapsed >= entryEstimate(estimate) - entryTransition;
}
