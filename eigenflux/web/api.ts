import { feedbackMessage, transientFailure } from './feedback-message';
import { useCallback, useEffect, useState } from 'react';
import { ReadCache } from './read-cache';
const reads = new ReadCache();
let readScope = '';
function readKey(path: string) {
  const scope = csrfCookie(document.cookie);
  if (scope !== readScope) {
    reads.clear();
    readScope = scope;
  }
  return `${scope}:${path}`;
}
const messages: Record<string, string> = {
  HANDOFF_INVALID: '请登录账号继续。',
  CONNECTION_INVALID: '无法打开注册页面，请从原 Agent 重新打开。',
  REVISION_CONFLICT: '资料已更新。你的填写仍保留，请核对最新资料后重试。',
  CONSOLE_ACCOUNT_LIMIT_REACHED:
    '此浏览器已登录五位 Agent，请选择一个会话退出后继续。',
  CONSOLE_SESSION_REQUIRED: '请重新登录账号。',
  CONSOLE_SESSION_INVALID: '请重新登录账号。',
  CSRF_INVALID: '页面的登录状态已变化，请重新打开控制台后再保存。',
  OWNER_BINDING_REQUIRED: '请登录账号继续。',
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(
      messages[code || ''] ||
        feedbackMessage(
          message,
          status >= 500
            ? '服务暂时繁忙，请稍后重试。'
            : '这次操作未完成，请重试。',
        ),
    );
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
  // Local page review never sends credentials, SMS requests, or mutations.
  // Vite removes this branch and its fixture module from production builds.
  if (import.meta.env.DEV && location.pathname.startsWith('/preview/')) {
    const { previewRequest } = await import('./preview-data');
    return previewRequest<T>(path, method, location.pathname);
  }
  const response = await fetch(`/api/v2/${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(window.parent !== window ? { 'X-Console-Embedded': '1' } : {}),
      ...(method === 'GET'
        ? {}
        : { 'X-CSRF-Token': csrfCookie(document.cookie) }),
    },
    ...(method !== 'GET' && body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(20000),
  }).catch((error: unknown) => {
    const timeout =
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name);
    throw new ApiError(
      0,
      method !== 'GET'
        ? '结果暂未确认，请先查看最新状态再重试。'
        : timeout
          ? '等待时间有些长，请稍后重试。'
          : '连接暂时中断，请稍后重试。',
      timeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
    );
  });
  const result = await response
    .json()
    .catch(() => ({ error: { message: '服务暂时不可用，请稍后重试。' } }));
  if (
    !response.ok ||
    result.error ||
    (typeof result.code === 'number' && result.code !== 0)
  ) {
    if (
      path !== 'console/session' &&
      !path.startsWith('auth/') &&
      !path.startsWith('console/handoffs') &&
      (response.status === 401 ||
        result.error?.code === 'OWNER_BINDING_REQUIRED')
    )
      refreshData();
    if ([401, 403].includes(response.status)) reads.clear();
    throw new ApiError(
      response.status,
      result.error?.message || result.msg || '请求失败',
      result.error?.code,
      result.error?.details,
    );
  }
  if (method !== 'GET') reads.clear();
  return result.data as T;
}
export const refreshData = () =>
  window.dispatchEvent(new Event('agentnet:refresh'));
export function useData<T>(
  path: string | null,
  { live = true }: { live?: boolean } = {},
) {
  const key = path ? readKey(path) : '';
  const cached = path ? reads.peek<T>(key) : undefined;
  const [result, setResult] = useState<{
    path: string | null;
    key?: string;
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
    if (!path) return;
    let active = true;
    let running = false;
    let retryable = false;
    let delay = 5000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!active || running) return;
      running = true;
      clearTimeout(timer);
      try {
        const data = await reads.read<T>(key, () => api<T>(path), version > 0);
        if (active) {
          retryable = false;
          setResult((previous) => ({
            path,
            key,
            data:
              previous.key === key &&
              JSON.stringify(previous.data) === JSON.stringify(data)
                ? previous.data
                : data,
            error: '',
          }));
        }
      } catch (error) {
        if (!active) return;
        retryable = transientFailure(error);
        setResult((previous) => {
          const denied =
            error instanceof ApiError && [401, 403].includes(error.status);
          const data =
            previous.key === key && !denied ? previous.data : undefined;
          return {
            path,
            key,
            data,
            error:
              data !== undefined && retryable ? '' : feedbackMessage(error),
          };
        });
        if (retryable) {
          timer = setTimeout(() => void load(), delay);
          delay = Math.min(delay * 2, 30000);
        }
      } finally {
        running = false;
      }
    };
    const reconnect = () => {
      if (retryable) void load();
    };
    void load();
    window.addEventListener('online', reconnect);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('online', reconnect);
    };
  }, [path, key, version]);
  const data = result.key === key ? result.data : cached;
  return {
    data: path ? data : undefined,
    error: result.key === key ? result.error : '',
    loading: !!path && data === undefined && result.key !== key,
    reload,
  };
}
export const requestKey = () => crypto.randomUUID();
