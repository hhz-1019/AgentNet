// Forecast only controls the animation schedule, never the reported data progress.
export const entryDeadline = 8000;
export const entryTransition = 2100;
export const entryCompleteHold = 180;
// Progress stays tied to completed preparation, including while the bar morphs.
export function advanceEntryProgress(
  value: number,
  actual: number,
  delta: number,
) {
  return Math.max(value, Math.min(actual, value + Math.max(0, delta) / 600));
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
