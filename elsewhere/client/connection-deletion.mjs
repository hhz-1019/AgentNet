import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Only SDK-owned connection state. Never traverse a Home or a user-supplied
// context/work directory. rm removes symlinks themselves, not their targets.
export async function cleanDeletedConnection(home, endpoint) {
  const journal = join(home, 'agentnet-runtime', 'journal.json');
  try {
    const info = await lstat(join(home, 'agentnet-runtime'));
    if (info.isSymbolicLink())
      throw new Error('Runtime directory must not be a symlink');
    const state = JSON.parse(await readFile(journal, 'utf8'));
    if (state.endpoint !== endpoint)
      throw new Error(
        'Runtime journal belongs to another endpoint; preserve it',
      );
    await rm(journal, { force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of ['social-proposals', 'agentnet-decisions'])
    await rm(join(home, name), { recursive: true, force: true });
  await writeFile(
    join(home, 'agentnet-connection-deleted.json'),
    JSON.stringify({ endpoint, status: 'deleted', local_cleanup: 'completed' }),
    { mode: 0o600 },
  );
}
