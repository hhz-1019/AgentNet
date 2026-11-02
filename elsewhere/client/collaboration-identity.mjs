import {
  access,
  readFile,
  writeFile,
  mkdir,
  link,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  createHash,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import { collaborationRequest } from './collaboration.mjs';
import { saveJSON } from './collaboration-background-policy.mjs';

const keyName = 'collaboration-key.json';
const infoName = 'collaboration-identity.json';
const missing = (error) => {
  if (error.code !== 'ENOENT') throw error;
  return false;
};
export async function hasInstallation(home) {
  return access(join(home, keyName)).then(() => true, missing);
}
export async function collaborationIdentity(client) {
  if (client instanceof InstallationClient) {
    if (!client.ready) await client.connect();
    return client.identity.agent_id;
  }
  return JSON.parse(
    await readFile(
      join(client.cliHome, 'servers/agentnet/agent-v2-credentials.json'),
      'utf8',
    ),
  ).agent_id;
}

// Atomic creation: concurrent hosts keep the winning key. Never overwrite a key,
// create an identity after authentication failure, or follow a foreign redirect.
export class InstallationClient {
  constructor({
    home,
    endpoint,
    binary = process.execPath,
    allowLoopback = false,
    fetchImpl = fetch,
  }) {
    const u = new URL(endpoint);
    if (
      (u.protocol !== 'https:' &&
        !(
          allowLoopback &&
          u.protocol === 'http:' &&
          ['127.0.0.1', '[::1]'].includes(u.hostname)
        )) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== '/'
    )
      throw new Error('HTTPS origin required');
    this.endpoint = u.origin;
    this.cliHome = resolve(home);
    this.binary = resolve(binary);
    this.fetchImpl = fetchImpl;
    this.ready = false;
  }
  async loadKey() {
    await mkdir(this.cliHome, { recursive: true, mode: 0o700 });
    const file = join(this.cliHome, keyName);
    if (!(await hasInstallation(this.cliHome))) {
      if (await access(join(this.cliHome, infoName)).then(() => true, missing))
        throw new Error('Restore the existing installation key');
      const pair = generateKeyPairSync('ed25519');
      const key = {
        version: 1,
        endpoint: this.endpoint,
        private_key: pair.privateKey
          .export({ type: 'pkcs8', format: 'pem' })
          .toString(),
      };
      const temporary = file + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(key), {
        flag: 'wx',
        mode: 0o600,
      });
      try {
        await link(temporary, file);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      } finally {
        await unlink(temporary);
      }
    }
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (saved.version !== 1 || saved.endpoint !== this.endpoint)
      throw new Error('Existing installation belongs to another service');
    this.privateKey = createPrivateKey(saved.private_key);
    if (this.privateKey.asymmetricKeyType !== 'ed25519')
      throw new Error('Invalid installation key');
    this.publicKey = Buffer.from(
      createPublicKey(this.privateKey).export({ format: 'jwk' }).x,
      'base64url',
    ).toString('base64url');
    this.fingerprint = createHash('sha256')
      .update(Buffer.from(this.publicKey, 'base64url'))
      .digest('hex');
    let previous;
    try {
      previous = JSON.parse(
        await readFile(join(this.cliHome, infoName), 'utf8'),
      );
    } catch (error) {
      missing(error);
    }
    if (
      previous &&
      (previous.endpoint !== this.endpoint ||
        previous.key_fingerprint !== this.fingerprint)
    )
      throw new Error(
        'Restore the original installation key before reconnecting',
      );
  }
  async request(path, data) {
    const body = JSON.stringify(data),
      timestamp = String(Math.floor(Date.now() / 1000)),
      nonce = randomBytes(16).toString('hex');
    const message = [
      'ELSEWHERE-COLLABORATION-V1',
      this.endpoint,
      'POST',
      path,
      timestamp,
      nonce,
      createHash('sha256').update(body).digest('hex'),
    ].join('\n');
    const response = await this.fetchImpl(this.endpoint + path, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        'X-Elsewhere-Key': this.publicKey,
        'X-Elsewhere-Time': timestamp,
        'X-Elsewhere-Nonce': nonce,
        'X-Elsewhere-Proof': sign(
          null,
          Buffer.from(message),
          this.privateKey,
        ).toString('base64url'),
      },
      body,
    });
    // Bound streamed responses too; do not trust Content-Length.
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024)
        throw new Error('Collaboration response too large');
      chunks.push(chunk);
    }
    let value;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      /* Proxies may return non-JSON failures. */
    }
    if (!response.ok) {
      const e = new Error(
        response.status === 401
          ? 'Restore the existing collaboration connection'
          : 'Collaboration request unavailable',
      );
      e.status = response.status;
      // A structured 4xx is a definite rejection, not an uncertain transport
      // effect. Preserve this contract so version conflicts do not quarantine
      // a background run after the model successfully retries with fresh context.
      if (
        response.status >= 400 &&
        response.status < 500 &&
        /^COLLABORATION_[A-Z_]{1,64}$/.test(value?.error?.code || '')
      )
        e.apiCode = value.error.code;
      throw e;
    }
    if (value?.error || !value?.data)
      throw new Error('Invalid collaboration response');
    return value.data;
  }
  async connect({ displayName } = {}) {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.loadKey();
      const identity = await this.request(
        '/api/v2/plugin/connect',
        displayName ? { display_name: displayName } : {},
      );
      if (
        !/^\d+$/.test(identity.agent_id) ||
        !identity.short_id ||
        identity.identity_kind !== 'installation_key'
      )
        throw new Error('Invalid collaboration identity');
      const file = join(this.cliHome, infoName);
      let previous;
      try {
        previous = JSON.parse(await readFile(file, 'utf8'));
      } catch (e) {
        missing(e);
      }
      if (
        previous &&
        (previous.agent_id !== identity.agent_id ||
          previous.endpoint !== this.endpoint)
      )
        throw new Error('Installation identity changed');
      // Metadata contains no secrets. The key is already durably saved before enrollment.
      await saveJSON(file, {
        ...identity,
        endpoint: this.endpoint,
        key_fingerprint: this.fingerprint,
      });
      this.identity = identity;
      this.ready = true;
      return identity;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
}
for (const group of [
  'project',
  'membership',
  'tasks',
  'context',
  'updates',
  'submit',
  'review',
]) {
  InstallationClient.prototype['collaboration_' + group] = async function (
    request,
  ) {
    const value = collaborationRequest(group, request);
    if (!this.ready) await this.connect();
    return this.request('/api/v2/plugin/collaboration/' + group, value);
  };
}

// Background processes reuse an existing key; they never provision a fresh identity.
export async function existingCollaborationClient(options) {
  if (await hasInstallation(options.home))
    return new InstallationClient({
      ...options,
      allowLoopback: process.env.AGENTNET_PLUGIN_TEST_LOOPBACK === '1',
    });
  if (await access(join(options.home, infoName)).then(() => true, missing))
    throw new Error('Restore the existing installation key');
  if (process.env.AGENTNET_IDENTITY_MODE === 'installation')
    return new InstallationClient({
      ...options,
      allowLoopback: process.env.AGENTNET_PLUGIN_TEST_LOOPBACK === '1',
    });
  const { Elsewhere } = await import('./sdk.mjs');
  return new Elsewhere(options);
}
