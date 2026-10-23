import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

// Scan every tracked file, including the pinned dependency; never print contents
// from ignored private configuration, Agent Homes or generated audit snapshots.
const tracked = execFileSync('git', ['ls-files', '--recurse-submodules', '-z'], {
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}).split('\0').filter(Boolean);
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const files = [...new Set([...tracked, ...added])].filter((path) => path !== 'docs/brand-rename-audit.json');
const remaining = [];
const stale = [];
let binary = 0;
for (const path of files) {
  const data = await readFile(path);
  if (data.includes(0)) { binary++; continue; }
  const text = data.toString('utf8');
  const matches = [...text.matchAll(/eigenflux/gi)];
  if (!matches.length && !/eigenflux/i.test(path)) continue;
  const dependency = path.startsWith('upstream/elsewhere/');
  const patch = path.startsWith('elsewhere/patches/');
  const auditRule = path === 'elsewhere/scripts/brand-audit.mjs';
  if (!dependency && !patch && !auditRule) {
    if (/eigenflux/i.test(path)) stale.push(path + ': filename');
    // Real upstream URLs and .eigenflux identity Homes are compatibility data.
    const owned = text.replace(/https?:\/\/[^\s<>"'`)]+/g, '').replace(/\.eigenflux\//g, '');
    if (/(?:^|[^\w.-])eigenflux\//m.test(owned) || /upstream\/eigenflux|eigenflux-core\.yml|\/build\/eigenflux/.test(owned))
      stale.push(path + ': obsolete project path');
  }
  remaining.push({ path, occurrences: matches.length, lines: [...new Set(matches.map((m) => text.slice(0, m.index).split('\n').length))],
    category: auditRule ? 'audit-rule' : dependency ? 'pinned-upstream' : patch ? 'upstream-patch-context' : path.endsWith('.go') ? 'upstream-module-or-compatible-protocol' : 'source-attribution-or-identity-compatibility' });
}
const report = { scannedFiles: files.length, binaryFiles: binary, staleProjectPaths: stale, remaining };
if (process.argv.includes('--write'))
  await writeFile('docs/brand-rename-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ scannedFiles: files.length, binaryFiles: binary, remainingFiles: remaining.length, staleProjectPaths: stale }, null, 2));
if (stale.length) process.exitCode = 1;
