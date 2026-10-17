import { onCLS, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

// No account IDs, URLs, search strings, text or image addresses are transmitted.
export function performanceRoute(path: string, hash = '') {
  const section = (
    hash.replace(/^#/, '') || path.replace(/^\/dashboard\/?/, '')
  ).split('/')[0];
  if (['explore', 'messages', 'crossing', 'person'].includes(section))
    return section;
  if (/onboard|register/.test(path)) return 'onboarding';
  return 'other';
}
export function startPerformanceMetrics() {
  if (location.pathname.startsWith('/preview') || navigator.doNotTrack === '1')
    return;
  const route = performanceRoute(location.pathname, location.hash);
  const device = matchMedia('(max-width: 700px)').matches
    ? 'mobile'
    : 'desktop';
  const sent = new Set<string>();
  const send = (name: string, value: number) => {
    if (!Number.isFinite(value) || sent.has(name)) return;
    sent.add(name);
    void fetch('/api/v2/performance', {
      method: 'POST',
      credentials: 'omit',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value, route, device }),
    }).catch(() => {});
  };
  const vital = (metric: Metric) => send(metric.name, metric.value);
  onLCP(vital);
  onINP(vital);
  onCLS(vital);
  onTTFB(vital);
  // Includes the entry animation; standard LCP may otherwise measure the logo.
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'elsewhere:entry-interactive')
        send('ENTRY', entry.startTime);
    }
  });
  observer.observe({ type: 'mark', buffered: true });
  window.addEventListener('pagehide', () => observer.disconnect(), {
    once: true,
  });
}
