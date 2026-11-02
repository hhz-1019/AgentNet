import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enable } from './collaboration-enable.mjs';
await test('background shortcut rejects unbounded budgets before opening a connection', async () => {
  for (const args of [
    { hours: 0 },
    { hours: 25 },
    { turns: 0 },
    { turns: 33 },
    { turns: 1.5 },
  ])
    await assert.rejects(
      enable({ connection: 'missing', project: 'p', ...args }),
      /1–24 hours/,
    );
});
await test('unsupported host shortcut does not create authorization or start a worker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'elsewhere-enable-'));
  const connection = join(dir, 'connection.json');
  await writeFile(connection, JSON.stringify({ host: 'generic' }));
  await assert.rejects(enable({ connection, project: 'p' }), /Codex only/);
  assert.deepEqual(await readdir(dir), ['connection.json']);
});
