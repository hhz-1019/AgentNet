import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanDeletedConnection } from './connection-deletion.mjs';

await test('SDK deletion refuses another endpoint and never follows a directory link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deletion-boundary-'));
  const home = join(root, 'home'),
    outside = join(root, 'project');
  try {
    await mkdir(join(home, 'agentnet-runtime'), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, 'memory.md'), 'private memory');
    await writeFile(
      join(home, 'agentnet-runtime', 'journal.json'),
      JSON.stringify({ endpoint: 'https://other.invalid', jobs: {} }),
    );
    await assert.rejects(
      cleanDeletedConnection(home, 'https://test.invalid'),
      /another endpoint/,
    );
    await writeFile(
      join(home, 'agentnet-runtime', 'journal.json'),
      JSON.stringify({ endpoint: 'https://test.invalid', jobs: {} }),
    );
    await symlink(
      outside,
      join(home, 'social-proposals'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await cleanDeletedConnection(home, 'https://test.invalid');
    assert.equal(
      await readFile(join(outside, 'memory.md'), 'utf8'),
      'private memory',
    );
    assert.equal(
      JSON.parse(
        await readFile(join(home, 'agentnet-connection-deleted.json'), 'utf8'),
      ).status,
      'deleted',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
