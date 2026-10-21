import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommenderRelease } from './aliyun-hk-recommender-release.mjs';

await test('ranking release preserves apps and data, isolates local inference and disables paid ranking', () => {
  const old = { name: 'elsewhere', services: {
    core: {image: 'core'}, web: {image: 'web'}, sync: {image: 'sync'},
    gorse: {image: 'old', env_file: ['/private/gorse.env'], environment: {RERANKER_URL: 'existing'}, volumes: [
      {target: '/var/lib/gorse', source: '/existing/data'}, {target: '/etc/gorse/config.toml', source: '/old/config'},
    ]},
  }};
  const localImage = 'sha256:' + 'b'.repeat(64);
  const next = recommenderRelease(old, 'sha256:' + 'a'.repeat(64), localImage);
  for (const name of ['core', 'web', 'sync']) assert.deepEqual(next.services[name], old.services[name]);
  assert.deepEqual(next.services.gorse.env_file, old.services.gorse.env_file);
  assert.equal(next.services.gorse.environment.RERANKER_URL, 'http://local-ranker:8090/v1/rerank');
  assert.equal(next.services.gorse.environment.RERANKER_AUTH_TOKEN, '');
  assert.equal(next.services.gorse.environment.RERANKER_DAILY_CALL_LIMIT, '0');
  assert.equal(next.services.gorse.environment.RERANKER_DAILY_TOKEN_LIMIT, '0');
  assert.equal(next.services.gorse.environment.RERANKER_MODE, 'local');
  assert.equal(next.networks['local-ranking'].internal, true);
  assert.deepEqual(next.services['local-ranker'].networks, {'local-ranking': null});
  assert.equal(next.services['local-ranker'].ports, undefined);
  assert.equal(next.services['local-ranker'].image, localImage);
  assert.equal(next.services['local-ranker'].read_only, true);
  assert.deepEqual(next.services.gorse.volumes, [old.services.gorse.volumes[0]]);
  assert.equal(old.services.gorse.image, 'old');
  old.services.gorse.volumes = [];
  assert.throws(() => recommenderRelease(old, 'sha256:' + 'a'.repeat(64), localImage), /durable/);
});
