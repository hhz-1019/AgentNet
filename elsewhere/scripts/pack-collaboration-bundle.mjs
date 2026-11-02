import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const directory = resolve(process.argv[2]);
const manifest = JSON.parse(
  await readFile(join(directory, 'manifest.json'), 'utf8'),
);
if (
  manifest.version !== '0.0.54-agentnet.29' ||
  !['windows-amd64', 'windows-arm64', 'darwin-amd64', 'darwin-arm64'].includes(
    manifest.platform,
  )
)
  throw new Error('Unknown bundle');
const windows = manifest.platform.startsWith('windows');
const archive = join(
  dirname(directory),
  `elsewhere-pilot-${manifest.version}-${manifest.platform}.${windows ? 'zip' : 'tar.gz'}`,
);
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
  });
if (windows) run('tar', ['-a', '-cf', archive, '-C', directory, '.']);
else if (process.platform === 'win32') {
  // NTFS chmod is insufficient: explicitly encode executable modes in the archive.
  const source = run('wsl.exe', ['--exec', 'wslpath', '-u', directory]).trim();
  const target = run('wsl.exe', ['--exec', 'wslpath', '-u', archive]).trim();
  run('wsl.exe', [
    '--exec',
    'tar',
    '--mode=755',
    '-czf',
    target,
    '-C',
    source,
    '.',
  ]);
} else run('tar', ['-czf', archive, '-C', directory, '.']);
const listing = run('tar', ['-tvf', archive]);
if (!windows)
  for (const name of ['Install.command', 'runtime/node', 'runtime/elsewhere']) {
    const line = listing
      .split('\n')
      .map((line) => line.trimEnd())
      .find((line) => line.endsWith('./' + name));
    if (!line || line[3] !== 'x')
      throw new Error('Missing executable archive mode: ' + name);
  }
const digest = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(archive + '.sha256', digest + '\n');
console.log(
  JSON.stringify(
    { archive, sha256: digest, executableModesVerified: !windows },
    null,
    2,
  ),
);
