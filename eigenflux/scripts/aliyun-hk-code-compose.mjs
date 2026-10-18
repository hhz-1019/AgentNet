import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Preserve data mounts and infrastructure verbatim. Only application code and
// its private environment files move to the candidate release.
export function releaseCompose(old, { previous, root, images }) {
  assert.equal(old.name, 'elsewhere');
  const next = structuredClone(old);
  for (const name of ['core', 'web', 'gorse', 'sync']) {
    assert(next.services[name], `Missing service: ${name}`);
    const service = next.services[name];
    assert.match(images[name], /^sha256:[a-f0-9]{64}$/);
    service.image = images[name];
    service.pull_policy = 'never';
    service.env_file = (service.env_file ?? []).map(entry => {
      const path = typeof entry === 'string' ? entry : entry.path;
      assert(path.startsWith(previous + '/env/'), `Unexpected env path: ${name}`);
      const target = root + path.slice(previous.length);
      return typeof entry === 'string' ? target : { ...entry, path: target };
    });
    const replaced = { web: ['/srv', '/web'], gorse: ['/etc/gorse/config.toml', '/configs/gorse-config.toml'], sync: ['/app/sync.mjs', '/configs/sync-sync.mjs'] }[name];
    if (replaced) {
      service.volumes = (service.volumes ?? []).filter(m => {
        if (m.target !== replaced[0]) return true;
        assert.equal(m.type, 'bind');
        assert.equal(m.source, previous + replaced[1]);
        return false;
      });
    }
    if (name === 'gorse') {
      assert(Array.isArray(service.networks));
      assert(next.networks.outbound && !next.networks.outbound.internal);
      service.networks = [...new Set([...service.networks, 'outbound'])];
    }
  }
  return next;
}

export function readEnv(raw) {
  return Object.fromEntries(raw.split('\n').filter(line => line && !line.startsWith('#')).map(line => {
    const i = line.indexOf('=');
    assert(i > 0, 'Invalid private environment file');
    return [line.slice(0, i), line.slice(i + 1)];
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [previous, root] = process.argv.slice(2);
  assert.match(previous ?? '', /^\/srv\/elsewhere\/releases\/[a-z0-9-]+$/);
  assert.match(root ?? '', /^\/srv\/elsewhere\/releases\/hk-code-[a-f0-9]{40}$/);
  assert.notEqual(previous, root);
  const old = JSON.parse(fs.readFileSync(previous + '/compose.json', 'utf8'));
  const images = Object.fromEntries(['core', 'web', 'gorse', 'sync'].map(name => [name, fs.readFileSync(`${root}/evidence/${name}-image-id`, 'utf8').trim()]));
  const next = releaseCompose(old, { previous, root, images });
  const writeEnv = (name, values) => fs.writeFileSync(`${root}/env/${name}.env`, Object.entries(values).map(([k,v]) => {
    assert(!/[\r\n\0]/.test(k + v));
    return `${k}=${v}`;
  }).join('\n') + '\n', {mode:0o600});
  const core = readEnv(fs.readFileSync(root + '/env/core.env', 'utf8'));
  Object.assign(core, { CONSOLE_V2_ALLOWED_ORIGINS: 'https://elsewhere.twintalk.cn', CONSOLE_V2_PUBLIC_URL: 'https://elsewhere.twintalk.cn', PUBLIC_BASE_URL: 'https://elsewhere.twintalk.cn' });
  writeEnv('core', core);
  const gorse = readEnv(fs.readFileSync(root + '/env/gorse.env', 'utf8'));
  const privatePath = '/srv/elsewhere/secrets/recommender.env';
  if (fs.existsSync(privatePath)) {
    const provider = readEnv(fs.readFileSync(privatePath, 'utf8'));
    for (const key of ['RERANKER_URL', 'RERANKER_MODEL', 'RERANKER_AUTH_TOKEN']) if (provider[key] !== undefined) gorse[key] = provider[key];
  }
  assert(gorse.RERANKER_URL && gorse.RERANKER_MODEL, 'Configure private RERANKER_URL and RERANKER_MODEL before activation');
  const endpoint = new URL(gorse.RERANKER_URL);
  assert(['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password);
  writeEnv('gorse', gorse);
  // Existing SQLite data must continue to be addressed by the same paths.
  const previousConfig = fs.readFileSync(previous + '/configs/gorse-config.toml', 'utf8');
  const newConfig = fs.readFileSync('/recommender/gorse.toml', 'utf8');
  for (const field of ['data_store', 'cache_store']) {
    const match = text => text.match(new RegExp('^' + field + '\\s*=\\s*"([^"]+)"', 'm'))?.[1];
    assert(match(previousConfig) && match(previousConfig) === match(newConfig), `Review Gorse storage configuration before activation: ${field}`);
  }
  fs.writeFileSync(root + '/compose.json', JSON.stringify(next, null, 2) + '\n', {mode:0o600});
  console.log('CANDIDATE_COMPOSE_READY');
}
