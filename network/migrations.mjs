import { readFile, writeFile, rename } from 'node:fs/promises';
export function migrateState(input) {
  if (![2, 3].includes(input.version))
    throw Error('Unsupported network data version');
  const s = structuredClone(input);
  for (const u of s.users) {
    u.defaultAgentId ??= u.agentId || null;
    delete u.agentId;
  }
  for (const a of s.agents) {
    a.capabilities ??= a.keywords || [];
    a.metadata ??= {};
    a.needs ??= [];
    a.currentTask ??= '';
  }
  for (const c of s.connections) c.scopes ??= ['*'];
  s.relations ??= [];
  s.invocations ??= [];
  s.activityLogs ??= [];
  s.version = 3;
  return s;
}
export async function loadMigrated(file) {
  const raw = await readFile(file, 'utf8'),
    original = JSON.parse(raw),
    migrated = migrateState(original);
  if (original.version !== 3) {
    // Never overwrite the pre-migration recovery copy; fail closed if backup cannot be written.
    try {
      await writeFile(file + '.v2.backup', raw, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    await writeFile(file + '.migration.tmp', JSON.stringify(migrated), {
      mode: 0o600,
    });
    await rename(file + '.migration.tmp', file);
  }
  return migrated;
}
