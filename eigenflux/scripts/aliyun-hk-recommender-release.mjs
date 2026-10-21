import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export function recommenderRelease(old, image, localImage) {
  assert.equal(old.name, 'elsewhere');
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  assert.match(localImage, /^sha256:[a-f0-9]{64}$/);
  const next = structuredClone(old);
  const gorse = next.services.gorse;
  assert(gorse && !Array.isArray(gorse.environment));
  assert(gorse.volumes.some(v => v.target === '/var/lib/gorse'), 'Missing durable ranking volume');
  gorse.image = image;
  gorse.pull_policy = 'never';
  gorse.environment = {
    ...gorse.environment,
    RERANKER_MODE: 'local',
    RERANKER_URL: 'http://local-ranker:8090/v1/rerank',
    RERANKER_MODEL: 'bge-hybrid-v1',
    RERANKER_AUTH_TOKEN: '',
    RERANKER_DAILY_CALL_LIMIT: '0',
    RERANKER_DAILY_TOKEN_LIMIT: '0',
    RERANKER_BUDGET_DB: '/var/lib/gorse/ranking-guard.db',
  };
  // The fixed config is in the new image; retain every data mount.
  gorse.volumes = gorse.volumes.filter(v => v.target !== '/etc/gorse/config.toml');
  next.networks ??= {};
  next.networks['local-ranking'] = { internal: true };
  gorse.networks = Array.isArray(gorse.networks)
    ? Object.fromEntries(gorse.networks.map(name => [name, null]))
    : (gorse.networks ?? { default: null });
  gorse.networks['local-ranking'] = null;
  next.services['local-ranker'] = {
    image: localImage, pull_policy: 'never', container_name: 'elsewhere-local-ranker',
    restart: 'unless-stopped', read_only: true, user: '65532:65532',
    networks: { 'local-ranking': null }, cpus: 0.75, mem_limit: '1536m', pids_limit: 64,
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], tmpfs: ['/tmp:size=64m'],
    volumes: [
      { type: 'bind', source: '/opt/elsewhere-model-runtime/env', target: '/runtime', read_only: true },
      { type: 'bind', source: '/opt/elsewhere-model-runtime/model', target: '/model', read_only: true },
      { type: 'bind', source: '/opt/elsewhere-local-ranker-cache', target: '/cache' },
    ],
    healthcheck: {
      test: ['CMD', '/runtime/bin/python', '-c', 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8090/health",timeout=3).read()'],
      interval: '15s', timeout: '5s', retries: 5, start_period: '60s',
    },
    logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '2' } },
  };
  return next;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [previous, root, image, localImage] = process.argv.slice(2);
  assert.match(previous, /^\/srv\/elsewhere\/releases\/[a-z0-9-]+$/);
  assert.match(root, /^\/srv\/elsewhere\/releases\/hk-recommender-[a-f0-9]{40}$/);
  const next = recommenderRelease(JSON.parse(fs.readFileSync(previous + '/compose.json', 'utf8')), image, localImage);
  fs.writeFileSync(root + '/compose.json', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
}
