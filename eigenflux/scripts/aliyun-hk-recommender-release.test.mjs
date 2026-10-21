import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommenderRelease } from './aliyun-hk-recommender-release.mjs';

test('ranking release preserves application images, providers, credentials and durable data', () => {
  const old = { name: 'elsewhere', services: {
    core: {image: 'core'}, web: {image: 'web'}, sync: {image: 'sync'},
    gorse: {image: 'old', env_file: ['/private/gorse.env'], environment: {RERANKER_URL: 'existing'}, volumes: [
      {target: '/var/lib/gorse', source: '/existing/data'}, {target: '/etc/gorse/config.toml', source: '/old/config'},
    ]},
  }};
  const next = recommenderRelease(old, 'sha256:' + 'a'.repeat(64));
  for (const name of ['core', 'web', 'sync']) assert.deepEqual(next.services[name], old.services[name]);
  assert.deepEqual(next.services.gorse.env_file, old.services.gorse.env_file);
  assert.equal(next.services.gorse.environment.RERANKER_URL, 'existing');
  assert.equal(next.services.gorse.environment.RERANKER_DAILY_CALL_LIMIT, '60');
  assert.equal(next.services.gorse.environment.RERANKER_DAILY_TOKEN_LIMIT, '1000000');
  assert.deepEqual(next.services.gorse.volumes, [old.services.gorse.volumes[0]]);
  assert.equal(old.services.gorse.image, 'old');
  old.services.gorse.volumes = [];
  assert.throws(() => recommenderRelease(old, 'sha256:' + 'a'.repeat(64)), /durable/);
});
