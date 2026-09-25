import { useCallback, useEffect, useState } from 'react';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export function csrfCookie(cookie: string): string {
  const values = Object.fromEntries(
    cookie.split(';').map((part) => {
      const i = part.indexOf('=');
      return [part.slice(0, i).trim(), part.slice(i + 1)];
    }),
  );
  const slot = /^[1-4]$/.test(values.ef_console_v2_active || '')
    ? `_${values.ef_console_v2_active}`
    : '';
  return values[`ef_console_v2_csrf${slot}`] || '';
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(`/api/v2/${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(method === 'GET'
        ? {}
        : { 'X-CSRF-Token': csrfCookie(document.cookie) }),
    },
    ...(method !== 'GET' && body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response
    .json()
    .catch(() => ({ error: { message: '服务暂时不可用，请稍后重试。' } }));
  if (
    !response.ok ||
    result.error ||
    (typeof result.code === 'number' && result.code !== 0)
  )
    throw new ApiError(
      response.status,
      result.error?.message || result.msg || '请求失败',
      result.error?.code,
      result.error?.details,
    );
  return result.data as T;
}
export const refreshData = () =>
  window.dispatchEvent(new Event('agentnet:refresh'));
export function useData<T>(
  path: string | null,
  { live = true }: { live?: boolean } = {},
) {
  const [result, setResult] = useState<{
    path: string | null;
    data?: T;
    error: string;
  }>({ path: null, error: '' });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!live) return;
    window.addEventListener('agentnet:refresh', reload);
    return () => window.removeEventListener('agentnet:refresh', reload);
  }, [live, reload]);
  useEffect(() => {
    let active = true;
    if (path)
      api<T>(path)
        .then((d) => {
          if (active) setResult({ path, data: d, error: '' });
        })
        .catch((e) => {
          if (active)
            setResult((previous) => ({
              path,
              data: previous.path === path ? previous.data : undefined,
              error: String(e.message),
            }));
        });
    return () => {
      active = false;
    };
  }, [path, version]);
  return {
    data: result.path === path ? result.data : undefined,
    error: result.path === path ? result.error : '',
    loading: !!path && result.path !== path,
    reload,
  };
}
export const requestKey = () => crypto.randomUUID();
