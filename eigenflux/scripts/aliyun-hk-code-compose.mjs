import fs from 'node:fs';
import assert from 'node:assert/strict';
const [previous, root] = process.argv.slice(2);
assert.match(previous ?? '', /^\/srv\/elsewhere\/releases\/[a-z0-9-]+$/);
assert.match(root ?? '', /^\/srv\/elsewhere\/releases\/hk-code-[a-f0-9]{40}$/);
assert.notEqual(previous, root);
const old = JSON.parse(fs.readFileSync(previous + '/compose.json', 'utf8'));
const next = JSON.parse(JSON.stringify(old).split(previous + '/').join(root + '/'));
assert.equal(next.name, 'elsewhere');
for (const name of ['core', 'web']) {
  const id = fs.readFileSync(`${root}/evidence/${name}-image-id`, 'utf8').trim();
  assert.match(id, /^sha256:[a-f0-9]{64}$/);
  next.services[name].image = id;
  next.services[name].pull_policy = 'never';
}
// Only remove the migration's temporary static overlay; keep every data mount.
const mounts = next.services.web.volumes ?? [];
for (const m of mounts.filter(m => m.target === '/srv')) {
  assert.equal(m.type, 'bind');
  assert.equal(m.source, root + '/web');
}
next.services.web.volumes = mounts.filter(m => m.target !== '/srv');
for (const [name, service] of Object.entries(old.services)) {
  if (['core', 'web'].includes(name)) continue;
  // Other services keep their existing configuration and are never recreated.
  next.services[name] = service;
}
const envPath = root + '/env/core.env';
const env = fs.readFileSync(envPath, 'utf8');
assert.match(env, /^CONSOLE_V2_ALLOWED_ORIGINS=/m);
fs.writeFileSync(envPath, env.replace(/^CONSOLE_V2_ALLOWED_ORIGINS=.*$/m, 'CONSOLE_V2_ALLOWED_ORIGINS=https://elsewhere.twintalk.cn'), { mode: 0o600 });
fs.writeFileSync(root + '/compose.json', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
console.log('CANDIDATE_COMPOSE_READY');
