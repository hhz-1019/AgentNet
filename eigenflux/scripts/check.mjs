import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
export function checkConfig(env, { providers = true } = {}) {
  const errors = [];
  for (const key of [
    'PUBLIC_BASE_URL',
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'CONSOLE_V2_BOOTSTRAP_SECRET',
    'CONSOLE_V2_OTP_PEPPER',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'LLM_API_KEY',
    'LLM_BASE_URL',
    'LLM_MODEL',
    'EMBEDDING_BASE_URL',
    'EMBEDDING_MODEL',
    'EMBEDDING_DIMENSIONS',
  ]) {
    if (!providers && /^(LLM_|EMBEDDING_|RESEND_)/.test(key)) continue;
    if (!env[key]?.trim() || /your-.*key|changeme|replace-me/i.test(env[key]))
      errors.push(`${key} is missing or a placeholder`);
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
    } catch {
      errors.push(
        `${key} must be a valid HTTP(S) URL (PUBLIC_BASE_URL must be an origin)`,
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
    errors.push('Email verification must stay enabled');
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
