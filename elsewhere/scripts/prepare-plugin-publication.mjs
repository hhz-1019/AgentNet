// Copy only collaboration work and the explicitly built plugin to an isolated checkout.
// Publication itself remains an explicit git operation after review.
import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
} from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
const target = resolve(process.argv[2]);
const distribution = resolve(process.argv[3]);
if (
  !target.startsWith(resolve('.agentnet-audit') + '\\') &&
  !target.startsWith(resolve('.agentnet-audit') + '/')
)
  throw new Error('Use an isolated audit checkout');
const tracked = execFileSync('git', ['diff', '--name-only'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);
const untracked = execFileSync(
  'git',
  ['ls-files', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);
const selected = [...new Set([...tracked, ...untracked])].filter((p) =>
  /^(core\/(api\/consolev2\/collaboration|cli\/internal\/auth\/v2_lock|cli\/cmd\/collaboration)|elsewhere\/client\/(collaboration|work\.test)|elsewhere\/scripts\/(.*codex-plugin|collaboration-|build-collaboration|pack-collaboration|runtime-archive|prepare-plugin-publication|installer-protocol)|elsewhere\/plugin\/|docs\/(CODEX_PLUGIN|COLLABORATION)|elsewhere\/Dockerfile\.|elsewhere\/web\/public\/(install\.|release\.json)|elsewhere\/skills\/agentnet-collaboration\/|package\.json$|core\/api\/consolev2\/capability_registry\.go$)/.test(
    p,
  ),
);
for (const file of selected) {
  await mkdir(dirname(join(target, file)), { recursive: true });
  await cp(file, join(target, file));
}
await cp(join(distribution, 'plugins'), join(target, 'plugins'), {
  recursive: true,
});
await cp(join(distribution, '.agents'), join(target, '.agents'), {
  recursive: true,
});
const attributes = join(target, '.gitattributes');
let existing = await readFile(attributes, 'utf8').catch((e) => {
  if (e.code === 'ENOENT') return '';
  throw e;
});
if (!existing.includes('/plugins/elsewhere/runtime/launch'))
  existing +=
    '\n/plugins/elsewhere/runtime/launch text eol=lf\n/plugins/elsewhere/runtime/*.gz binary\n';
await writeFile(attributes, existing);
const files = [];
async function scan(path, prefix = '') {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = prefix + entry.name,
      file = join(path, entry.name);
    if (name === 'elsewhere/PACKAGE-FILES.json') continue;
    if (entry.isSymbolicLink())
      throw new Error('Symlink in distribution: ' + name);
    if (entry.isDirectory()) await scan(file, name + '/');
    else {
      const size = (await stat(file)).size;
      if (size >= 100 * 1024 * 1024)
        throw new Error('GitHub size limit: ' + name);
      if (
        /(^|\/)(auth\.json|config\.toml|agent-v2-credentials\.json|\.env[^/]*|.*\.pem)$/.test(
          name,
        )
      )
        throw new Error('Private file in package: ' + name);
      if (!/\.(exe|gz|png|jpg|wasm|woff2?)$/.test(name) && size < 2000000) {
        const text = await readFile(file, 'utf8');
        if (
          /(?:gh[pousr]_[A-Za-z0-9]{25,}|sk-proj-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{40,})/.test(
            text,
          )
        )
          throw new Error('Credential-like content: ' + name);
      }
      files.push({ name, bytes: size });
    }
  }
}
await scan(join(target, 'plugins'));
await writeFile(
  join(target, 'plugins/elsewhere/PACKAGE-FILES.json'),
  JSON.stringify(files, null, 2),
);
console.log(
  JSON.stringify({
    target,
    sourceFiles: selected,
    distributionFiles: files.length,
    distributionBytes: files.reduce((s, f) => s + f.bytes, 0),
  }),
);
