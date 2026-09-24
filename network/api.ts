import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dashboard, ActionResult, Act } from './types';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  body?: unknown,
  csrf?: string | null,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-AgentNet-CSRF': csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal || AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(value.error || '请求失败，请重试。', response.status);
  return value as T;
}
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : '服务暂不可用，请重试。';
export function useNetwork(notify: (text: string) => void) {
  const [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [updated, setUpdated] = useState(0);
  const dataRef = useRef(data),
    revision = useRef(0),
    mutating = useRef(false),
    loading = useRef(false),
    mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (loading.current || mutating.current) return;
    loading.current = true;
    const stamp = revision.current;
    try {
      const next = await request<Dashboard>('/api/v1/owner');
      if (mounted.current && stamp === revision.current) {
        dataRef.current = next;
        setData(next);
        setError('');
        setUpdated(Date.now());
      }
    } catch (e) {
      if (mounted.current) setError(errorText(e));
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    const resume = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [refresh]);
  const act: Act = useCallback(
    async (action, payload, success) => {
      if (mutating.current) return null;
      mutating.current = true;
      revision.current++;
      setBusy(true);
      try {
        const next = await request<ActionResult>(
          '/api/v1/owner',
          { action, payload },
          dataRef.current?.csrf,
        );
        dataRef.current = next;
        setData(next);
        setError('');
        setUpdated(Date.now());
        if (success) notify(success);
        return next;
      } catch (e) {
        notify(errorText(e));
        if (e instanceof ApiError && e.status === 401) {
          setData(null);
          setError('登录已过期，请重新登录。');
        }
        return null;
      } finally {
        mutating.current = false;
        revision.current++;
        setBusy(false);
      }
    },
    [notify],
  );
  const accept = (next: Dashboard) => {
    revision.current++;
    dataRef.current = next;
    setData(next);
    setError('');
    setUpdated(Date.now());
  };
  return { data, error, busy, updated, refresh, act, accept };
}
// One source of truth for polling today; a future SSE notification can call refresh().
export function useRoute() {
  const read = () =>
    window.location.pathname
      .replace(/^\/dashboard\/?/, '')
      .replace(/\/$/, '') || 'overview';
  const [route, setRoute] = useState(() =>
    window.location.pathname === '/' ? 'overview' : read(),
  );
  useEffect(() => {
    const pop = () => setRoute(read());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const navigate = (path: string) => {
    const next = path === 'overview' ? '' : path;
    window.history.pushState(null, '', `/dashboard${next ? '/' + next : ''}`);
    setRoute(path || 'overview');
    window.scrollTo({ top: 0 });
  };
  return { route, navigate };
}
