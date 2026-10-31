import { execFileSync } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  symlink,
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
        'LICENSE',
        'elsewhere/web',
        'core',
        'elsewhere/skills/agentnet-onboarding',
        'elsewhere/skills/agentnet-handoff',
        'elsewhere/skills/agentnet-collaboration',
        'elsewhere/skills/agentnet-social',
        'elsewhere/Caddyfile',
      ]
    : [
        'core',
        'elsewhere/friend_request_limits.yaml',
        'elsewhere/scripts/entrypoint.sh',
      ];
const files = git('ls-files', '-z', '--', ...ownPaths)
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
  );
async function copy(source, destination = source) {
  const src = resolve(root, source),
    dst = resolve(target, destination);
  if (!src.startsWith(root + sep) || !dst.startsWith(target + sep))
    throw new Error('Package path escapes its source or destination.');
  if (basename(source).startsWith('.env'))
    throw new Error('Environment file in release input.');
  await mkdir(dirname(dst), { recursive: true });
  if ((await lstat(src)).isSymbolicLink()) {
    const link = await readlink(src);
    const linkedDestination = resolve(dirname(dst), link);
    if (!linkedDestination.startsWith(target + sep))
      throw new Error('Package symlink escapes its destination.');
    await symlink(link, dst);
  } else {
    await copyFile(src, dst);
  }
}
for (const file of files) await copy(file);
await copy(`elsewhere/Dockerfile.${service}`, 'Dockerfile');
await copy(`elsewhere/Dockerfile.${service}.dockerignore`, '.dockerignore');
if (service === 'core')
  await writeFile(resolve(target, 'Dockerfile'), '\nCMD ["deploy"]\n', {
    flag: 'a',
  });
await writeFile(
  resolve(target, 'release-build.json'),
  JSON.stringify({ service, revision }, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    directory: relative(root, target),
    service,
    revision,
    files: files.length + 3,
  }),
);
