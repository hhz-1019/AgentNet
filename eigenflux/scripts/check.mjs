import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
export function checkConfig(env, { providers = true } = {}) {
  const errors = [];
  const emailProvider = env.EMAIL_PROVIDER?.trim() || 'resend';
  const emailKeys =
    emailProvider === 'disabled'
      ? []
      : emailProvider === 'smtp'
        ? [
            'SMTP_HOST',
            'SMTP_PORT',
            'SMTP_USERNAME',
            'SMTP_PASSWORD',
            'SMTP_FROM_EMAIL',
          ]
        : ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'];
  if (!['smtp', 'resend', 'disabled'].includes(emailProvider))
    errors.push('EMAIL_PROVIDER must be smtp, resend or disabled');
  if (env.HUMAN_AUTH_MODE !== 'uid')
    errors.push('HUMAN_AUTH_MODE must be uid for this Console');
  if (env.SMS_PROVIDER !== 'aliyun-pnvs')
    errors.push('SMS_PROVIDER must be aliyun-pnvs');
  if (
    !/^[1-9]\d{0,6}$/.test(env.SMS_DAILY_LIMIT || '') ||
    Number(env.SMS_DAILY_LIMIT) > 1000000
  )
    errors.push('SMS_DAILY_LIMIT must be between 1 and 1000000');
  if (!['responses', 'chat_completions'].includes(env.LLM_API_STYLE))
    errors.push('LLM_API_STYLE must be responses or chat_completions');
  for (const key of [
    'PUBLIC_BASE_URL',
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'CONSOLE_V2_BOOTSTRAP_SECRET',
    'CONSOLE_V2_OTP_PEPPER',
    ...emailKeys,
    'SMS_ACCESS_KEY_ID',
    'SMS_ACCESS_KEY_SECRET',
    'SMS_SIGN_NAME',
    'SMS_TEMPLATE_CODE',
    'SMS_SCHEME_NAME',
    'LLM_API_KEY',
    'LLM_BASE_URL',
    'LLM_MODEL',
    'EMBEDDING_BASE_URL',
    'EMBEDDING_MODEL',
    'EMBEDDING_DIMENSIONS',
  ]) {
    if (!providers && /^(LLM_|EMBEDDING_|RESEND_|SMTP_|SMS_)/.test(key))
      continue;
    if (
      !env[key]?.trim() ||
      /your-.*key|changeme|replace-me|[<{]workspace[-_]?id[>}]/i.test(env[key])
    )
      errors.push(`${key} is missing or a placeholder`);
  }
  if (emailProvider === 'smtp') {
    if (env.SMTP_PORT !== '465')
      errors.push('SMTP_PORT must be 465 (implicit TLS)');
    if (env.SMTP_HOST && !/^[a-z0-9.-]+$/i.test(env.SMTP_HOST))
      errors.push('SMTP_HOST must be a hostname without protocol or port');
    if (providers) {
      const from = env.SMTP_FROM_EMAIL?.trim() || '';
      const address = from.match(/<([^<>]+)>$/)?.[1] || from;
      if (
        /[\r\n]/.test(from) ||
        !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)
      )
        errors.push('SMTP_FROM_EMAIL must be a valid sender address');
      if (env.SMTP_USERNAME !== address)
        errors.push('SMTP_USERNAME must match the DirectMail sender address');
    }
  }
  if (
    providers &&
    env.EMBEDDING_PROVIDER !== 'ollama' &&
    !env.EMBEDDING_API_KEY?.trim()
  )
    errors.push('EMBEDDING_API_KEY is missing');
  for (const key of ['PUBLIC_BASE_URL', 'LLM_BASE_URL', 'EMBEDDING_BASE_URL']) {
    if (!providers && key !== 'PUBLIC_BASE_URL' && !env[key]?.trim()) continue;
    try {
      const url = new URL(env[key]);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error();
      if (key === 'PUBLIC_BASE_URL' && url.origin !== env[key]) throw Error();
      if (
        key !== 'PUBLIC_BASE_URL' &&
        (url.search || url.hash || url.pathname.endsWith('/'))
      )
        throw Error();
    } catch {
      errors.push(
        `${key} must be a valid HTTP(S) URL without query, fragment or trailing slash (PUBLIC_BASE_URL must be an origin)`,
      );
    }
  }
  if (
    providers &&
    (!Number.isInteger(Number(env.EMBEDDING_DIMENSIONS)) ||
      Number(env.EMBEDDING_DIMENSIONS) < 1)
  )
    errors.push('EMBEDDING_DIMENSIONS must be a positive integer');
  if (env.ENABLE_EMAIL_VERIFICATION !== 'true')
    errors.push(
      'Legacy email bypass must stay disabled (ENABLE_EMAIL_VERIFICATION=true)',
    );
  for (const key of [
    'MOCK_OTP_EMAIL_SUFFIXES',
    'MOCK_OTP_IP_WHITELIST',
    'MOCK_UNIVERSAL_OTP',
    'OFFICIAL_TEST_EMAIL_SUFFIXES',
    'OFFICIAL_TEST_OTP',
  ])
    if (env[key]?.trim())
      errors.push(`${key} must be empty outside isolated tests`);
  if (
    env.CONSOLE_V2_BOOTSTRAP_SECRET &&
    env.CONSOLE_V2_BOOTSTRAP_SECRET === env.CONSOLE_V2_OTP_PEPPER
  )
    errors.push('Bootstrap secret and OTP pepper must be independent');
  for (const key of [
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'CONSOLE_V2_BOOTSTRAP_SECRET',
    'CONSOLE_V2_OTP_PEPPER',
  ])
    if (env[key] && !/^[a-f0-9]{64}$/.test(env[key]))
      errors.push(
        `${key} must contain 64 hexadecimal characters; use core:configure`,
      );
  return errors;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check.mjs')) {
  let env;
  try {
    env = parseEnv(await readFile('.env.eigenflux', 'utf8'));
  } catch {
    console.error('Run npm run core:configure first.');
    process.exit(1);
  }
  const deferred = process.argv.includes('--defer-providers');
  const errors = checkConfig(env, { providers: !deferred });
  const pin = JSON.parse(
    await readFile(new URL('../UPSTREAM.json', import.meta.url), 'utf8'),
  );
  try {
    if (
      execFileSync('git', ['-C', 'upstream/eigenflux', 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim() !== pin.revision
    )
      errors.push('Upstream revision differs from UPSTREAM.json');
  } catch {
    errors.push('Run git submodule update --init --recursive');
  }
  if (errors.length) {
    console.error(errors.map((s) => `- ${s}`).join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      deferred
        ? 'Source pin and infrastructure configuration verified. Provider activation is deferred; this is NOT production readiness.'
        : 'Configuration and upstream pin verified. Values are not printed.',
    );
}
