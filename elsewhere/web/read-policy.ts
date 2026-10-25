export function retryDelay(
  attempt: number,
  retryAfter = 0,
  random = Math.random(),
) {
  const ceiling = Math.min(30000, 5000 * 2 ** Math.min(attempt, 3));
  return Math.max(
    Math.min(120000, Math.max(0, retryAfter)),
    ceiling * (0.5 + 0.5 * random),
  );
}
export function activityRead(path: string) {
  return /^(console\/(social|pm|relations|groups|attention-items|activity|messages|conversations|communications|notifications|moment|crossing|friends|handoffs)|guest\/(feed|posts|people))([/?]|$)/.test(
    path,
  );
}
export function retryAfterDelay(value: string | null, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, Math.min(120000, delay)) : 0;
}
