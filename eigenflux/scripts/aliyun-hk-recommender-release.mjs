import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export function recommenderRelease(old, image) {
  assert.equal(old.name, 'elsewhere');
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const next = structuredClone(old);
  const gorse = next.services.gorse;
  assert(gorse && !Array.isArray(gorse.environment));
  assert(gorse.volumes.some(v => v.target === '/var/lib/gorse'), 'Missing durable ranking volume');
  gorse.image = image;
  gorse.pull_policy = 'never';
  gorse.environment = {
    ...gorse.environment,
    RERANKER_DAILY_CALL_LIMIT: '60',
    RERANKER_DAILY_TOKEN_LIMIT: '1000000',
    RERANKER_BUDGET_DB: '/var/lib/gorse/ranking-guard.db',
  };
  // The fixed config is in the new image; retain every data mount.
  gorse.volumes = gorse.volumes.filter(v => v.target !== '/etc/gorse/config.toml');
  return next;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [previous, root, image] = process.argv.slice(2);
  assert.match(previous, /^\/srv\/elsewhere\/releases\/[a-z0-9-]+$/);
  assert.match(root, /^\/srv\/elsewhere\/releases\/hk-recommender-[a-f0-9]{40}$/);
  const next = recommenderRelease(JSON.parse(fs.readFileSync(previous + '/compose.json', 'utf8')), image);
  fs.writeFileSync(root + '/compose.json', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
}
