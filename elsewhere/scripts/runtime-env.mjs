import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const runtimeKeys = [
  'PUBLIC_BASE_URL',
  'HUMAN_AUTH_MODE',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'CONSOLE_V2_BOOTSTRAP_SECRET',
  'CONSOLE_V2_OTP_PEPPER',
];

// Only inspect configuration files in the selected project root. Never follow
// discovered symlinks, search Agent Homes, or expose configuration values.
export async function readRuntimeEnv(
  root = process.cwd(),
  { envFile = process.env.AGENTNET_ENV_FILE } = {},
) {
  if (envFile?.trim()) {
    try {
      return await readFile(resolve(root, envFile.trim()), 'utf8');
    } catch {
      throw new Error('Cannot read AGENTNET_ENV_FILE; existing configuration was not changed.');
    }
  }
  try {
    return await readFile(resolve(root, '.env.elsewhere'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const candidates = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\.env\.[a-z0-9_-]+$/i.test(entry.name) ||
      /^\.env\.(?:example|sample|template)$/i.test(entry.name)) continue;
    const path = resolve(root, entry.name);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > 1024 * 1024) continue;
    const source = await readFile(path, 'utf8');
    const values = parseEnv(source);
    if (runtimeKeys.every((key) => Object.hasOwn(values, key)) && values.HUMAN_AUTH_MODE === 'uid')
      candidates.push(source);
  }
  if (candidates.length > 1)
    throw new Error('Multiple runtime configurations found; set AGENTNET_ENV_FILE explicitly. No configuration was changed.');
  if (candidates.length === 1) return candidates[0];
  throw Object.assign(new Error('No runtime configuration found.'), { code: 'ENOENT' });
}
