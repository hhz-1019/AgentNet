import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRuntimeEnv } from './runtime-env.mjs';

void test('old configuration is copied without rotating secrets; new configuration takes priority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elsewhere-config-'));
  try {
    const previous = 'POSTGRES_PASSWORD=existing-db-secret\nREDIS_PASSWORD=existing-cache-secret\nCONSOLE_V2_BOOTSTRAP_SECRET=existing-bootstrap\nCONSOLE_V2_OTP_PEPPER=existing-pepper\nLLM_API_KEY=synthetic-model-key\n';
    await writeFile(join(root, '.env.eigenflux'), previous);
    assert.equal(await readRuntimeEnv(root), previous);
    execFileSync(process.execPath, [fileURLToPath(new URL('./configure.mjs', import.meta.url))], { cwd: root });
    assert.equal(await readFile(join(root, '.env.elsewhere'), 'utf8'), previous);
    assert.equal(await readFile(join(root, '.env.eigenflux'), 'utf8'), previous);
    await writeFile(join(root, '.env.elsewhere'), 'LLM_API_KEY=new-synthetic-key\n');
    assert.equal(await readRuntimeEnv(root), 'LLM_API_KEY=new-synthetic-key\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
