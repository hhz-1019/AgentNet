import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRuntimeEnv } from './runtime-env.mjs';

const previous = 'PUBLIC_BASE_URL=https://inspiralai.com\nHUMAN_AUTH_MODE=uid\nPOSTGRES_PASSWORD=existing-db-secret\nREDIS_PASSWORD=existing-cache-secret\nCONSOLE_V2_BOOTSTRAP_SECRET=existing-bootstrap\nCONSOLE_V2_OTP_PEPPER=existing-pepper\nLLM_API_KEY=synthetic-model-key\n';
const configure = fileURLToPath(new URL('./configure.mjs', import.meta.url));
const env = { ...process.env, AGENTNET_ENV_FILE: '' };
const read = (root, envFile = '') => readRuntimeEnv(root, { envFile });

void test('previous configuration is adopted without rotating secrets; current configuration takes priority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elsewhere-config-'));
  try {
    await writeFile(join(root, '.env.previous'), previous);
    assert.equal(await read(root), previous);
    const output = execFileSync(process.execPath, [configure], { cwd: root, env, encoding: 'utf8' });
    assert.doesNotMatch(output, /existing-db-secret|synthetic-model-key/);
    assert.equal(await readFile(join(root, '.env.elsewhere'), 'utf8'), previous);
    assert.equal(await readFile(join(root, '.env.previous'), 'utf8'), previous);
    await writeFile(join(root, '.env.elsewhere'), 'LLM_API_KEY=new-synthetic-key\n');
    assert.equal(await read(root), 'LLM_API_KEY=new-synthetic-key\n');
    assert.equal(await read(root, '.env.previous'), previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('ambiguous configurations require an explicit file without replacing existing values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elsewhere-config-'));
  try {
    await writeFile(join(root, '.env.previous'), previous);
    await writeFile(join(root, '.env.production'), previous.replace('existing-db-secret', 'other-db-secret'));
    await assert.rejects(read(root), /Multiple runtime configurations/);
    assert.equal(await read(root, '.env.previous'), previous);
    const result = spawnSync(process.execPath, [configure], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /existing-db-secret|other-db-secret/);
    await assert.rejects(access(join(root, '.env.elsewhere')), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, '.env.previous'), 'utf8'), previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('discovery ignores unrelated files, templates, nested directories and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elsewhere-config-'));
  try {
    await writeFile(join(root, '.env.unrelated'), 'API_KEY=unrelated-secret\n');
    await writeFile(join(root, '.env.example'), previous);
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', '.env.previous'), previous);
    await symlink(join(root, 'nested', '.env.previous'), join(root, '.env.link'));
    await assert.rejects(read(root), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('an unreadable explicit configuration fails instead of generating new credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'elsewhere-config-'));
  try {
    await writeFile(join(root, '.env.previous'), previous);
    await assert.rejects(read(root, '.env.missing'), /Cannot read AGENTNET_ENV_FILE/);
    const result = spawnSync(process.execPath, [configure], {
      cwd: root, env: { ...env, AGENTNET_ENV_FILE: '.env.missing' }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    await assert.rejects(access(join(root, '.env.elsewhere')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
