import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { resolve, dirname, basename, relative, sep } from 'node:path';

// Package only committed source; never upload the workstation or Agent Homes.
const service = process.argv[2];
if (!['web', 'core'].includes(service))
  throw new Error('Usage: npm run deploy:package -- web|core');
const root = process.cwd();
const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
if (git('status', '--porcelain', '--untracked-files=no'))
  throw new Error('Commit tracked changes before packaging a release.');
const pin = JSON.parse(await readFile('eigenflux/UPSTREAM.json', 'utf8'));
if (git('-C', 'upstream/eigenflux', 'rev-parse', 'HEAD') !== pin.revision)
  throw new Error('Initialize the pinned upstream submodule before packaging.');
if (
  git(
    '-C',
    'upstream/eigenflux',
    'status',
    '--porcelain',
    '--untracked-files=no',
  )
)
  throw new Error(
    'Upstream has local tracked changes; use patches/overlay instead.',
  );
const revision = git('rev-parse', 'HEAD');
await mkdir('.agentnet-audit', { recursive: true });
const target = await mkdtemp(
  resolve('.agentnet-audit', `deploy-${service}-${revision.slice(0, 7)}-`),
);
const ownPaths =
  service === 'web'
    ? [
        'package.json',
        'package-lock.json',
        'eigenflux/web',
        'eigenflux/skills/agentnet-onboarding',
        'eigenflux/skills/agentnet-handoff',
        'eigenflux/Caddyfile',
        'eigenflux/overlay/cli',
        'eigenflux/patches/social-workspace.patch',
      ]
    : [
        'eigenflux/patches',
        'eigenflux/overlay',
        'eigenflux/friend_request_limits.yaml',
        'eigenflux/scripts/entrypoint.sh',
      ];
const files = git('ls-files', '-z', '--', ...ownPaths)
  .split('\0')
  .filter(Boolean);
const upstream = git('-C', 'upstream/eigenflux', 'ls-files', '-z')
  .split('\0')
  .filter(Boolean)
  .filter(
    (f) =>
      f !== 'cron' &&
      !f
        .split('/')
        .some(
          (part) =>
            part === '.git' ||
            part === 'node_modules' ||
            part.startsWith('.env'),
        ),
  )
  .map((f) => `upstream/eigenflux/${f}`);
async function copy(source, destination = source) {
  const src = resolve(root, source),
    dst = resolve(target, destination);
  if (!src.startsWith(root + sep) || !dst.startsWith(target + sep))
    throw new Error('Package path escapes its source or destination.');
  if (basename(source).startsWith('.env'))
    throw new Error('Environment file in release input.');
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
}
for (const file of [...files, ...upstream]) await copy(file);
await copy(`eigenflux/Dockerfile.${service}`, 'Dockerfile');
await copy(`eigenflux/Dockerfile.${service}.dockerignore`, '.dockerignore');
if (service === 'core')
  await writeFile(resolve(target, 'Dockerfile'), '\nCMD ["deploy"]\n', {
    flag: 'a',
  });
await writeFile(
  resolve(target, 'release-build.json'),
  JSON.stringify({ service, revision, upstream: pin.revision }, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    directory: relative(root, target),
    service,
    revision,
    files: files.length + upstream.length + 3,
  }),
);
