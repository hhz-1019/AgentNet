import { useEffect } from 'react';
import { api } from './api';

export function trackRegistration(event: string) {
  if (import.meta.env.DEV && location.pathname.startsWith('/preview')) return;
  // Only a fixed step name crosses the wire. Never send an input value.
  void api('console/registration/progress', { event }).catch(() => {});
}

export function useRegistrationTracking(
  enabled: boolean,
  step: 'form' | 'profile',
) {
  useEffect(() => {
    if (!enabled) return;
    const visible = () => {
      if (!document.hidden) trackRegistration('heartbeat');
    };
    if (!document.hidden) trackRegistration(step);
    const timer = window.setInterval(visible, 30000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, step]);
}
