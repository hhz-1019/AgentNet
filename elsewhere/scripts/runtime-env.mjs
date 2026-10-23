import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Read existing installations without moving, regenerating or logging secrets.
export async function readRuntimeEnv(root = process.cwd()) {
  try {
    return await readFile(resolve(root, '.env.elsewhere'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return readFile(resolve(root, '.env.eigenflux'), 'utf8');
  }
}
