import { useEffect } from 'react';
import { api } from './api';

export function useAnalyticsHeartbeat(identity?: string) {
  useEffect(() => {
    if (!identity || location.pathname.startsWith('/preview')) return;
    let pending = false;
    let lastSent = 0;
    const beat = async () => {
      if (
        document.visibilityState !== 'visible' ||
        pending ||
        Date.now() - lastSent < 45000
      )
        return;
      pending = true;
      lastSent = Date.now();
      try {
        await api('console/analytics/heartbeat', {});
      } catch {
        /* Telemetry never interrupts the user's task. */
      } finally {
        pending = false;
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 60000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [identity]);
}
