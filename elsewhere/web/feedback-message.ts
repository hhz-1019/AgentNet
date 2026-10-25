// Technical failures stay in diagnostics; UI copy describes a recoverable action.
export function feedbackMessage(
  value: unknown,
  fallback = '这次操作未完成，请重试。',
): string {
  const raw =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : '';
  const message = raw.trim();
  if (!message) return fallback;
  if (/Failed to fetch|NetworkError|NETWORK_ERROR|网络|连接服务/i.test(message))
    return '连接暂时中断，请稍后重试。';
  if (/timeout|超时/i.test(message)) return '等待时间有些长，请稍后重试。';
  if (/permission denied|forbidden/i.test(message))
    return '当前账号无法访问此内容。';
  if (/unauthorized|session.*(?:invalid|expired)/i.test(message))
    return '请登录后继续。';
  if (/not found/i.test(message)) return '这项内容已无法查看。';
  if (
    !/[\u3400-\u9fff]/u.test(message) ||
    message.length > 180 ||
    /<\/?[a-z][^>]*>|\b(?:SQLSTATE|SELECT|INSERT|UPDATE|DELETE|panic|stack|TypeError|ReferenceError|SyntaxError|postgres|ECONN\w*|localhost|traceback)\b|https?:\/\/|\/api\/|[A-Z]{3,}_[A-Z_]+|\bat \S+\([^)]*:\d+/i.test(
      message,
    )
  )
    return fallback;
  return message;
}

export function transientFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  return (
    error.status === 0 ||
    error.status === 408 ||
    error.status === 429 ||
    (typeof error.status === 'number' && error.status >= 500)
  );
}
