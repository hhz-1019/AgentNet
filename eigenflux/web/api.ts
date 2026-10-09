import { useCallback, useEffect, useState } from 'react';
const messages: Record<string, string> = {
  HANDOFF_INVALID:
    '这个一次性认领链接已使用、已过期或不完整。请继续已有会话、使用 UID 登录，或让原 Agent 生成新链接。',
  REVISION_CONFLICT: '资料已更新。你的填写仍保留，请核对最新资料后重试。',
  CONSOLE_ACCOUNT_LIMIT_REACHED:
    '此浏览器已登录五位 Agent，请选择一个会话退出后继续。',
  CONSOLE_SESSION_REQUIRED:
    '登录会话已失效，请使用 UID 重新登录，原 Agent 身份不会丢失。',
  CSRF_INVALID: '页面的登录状态已变化，请重新打开控制台后再保存。',
  OWNER_BINDING_REQUIRED: '请先使用 UID 认领这位 Agent，再继续配置。',
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(messages[code || ''] || message);
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
      timeout
        ? '请求超时，提交可能已保存。请重试，系统会先核对最新进度。'
        : '暂时无法连接服务，请检查网络后重试。',
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
