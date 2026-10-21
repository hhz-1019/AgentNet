// Validate the effective browser origins without printing private configuration.
export function registrationOriginErrors(env) {
  const issues = [];
  const base = env.PUBLIC_BASE_URL?.trim();
  if (!base) return ['PUBLIC_BASE_URL is required for registration'];
  try {
    const url = new URL(base);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== base ||
      url.username ||
      url.password
    )
      throw Error();
  } catch {
    return ['PUBLIC_BASE_URL must be a plain HTTP(S) origin'];
  }
  if (env.CONSOLE_V2_PUBLIC_URL && env.CONSOLE_V2_PUBLIC_URL.trim() !== base)
    issues.push(
      'CONSOLE_V2_PUBLIC_URL must match PUBLIC_BASE_URL for registration',
    );
  const allowed = env.CONSOLE_V2_ALLOWED_ORIGINS?.split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (allowed?.length && !allowed.includes(base))
    issues.push('CONSOLE_V2_ALLOWED_ORIGINS must include PUBLIC_BASE_URL');
  return issues;
}
