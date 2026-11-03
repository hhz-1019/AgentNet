import {
  readFile,
  writeFile,
  mkdir,
  rename,
  realpath,
  stat,
} from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const actionNames = [
  'context',
  'project.get',
  'project.complete',
  'updates.read',
  'updates.publish',
  'tasks.list',
  'tasks.get',
  'tasks.create',
  'tasks.assign',
  'tasks.accept',
  'tasks.start',
  'tasks.heartbeat',
  'tasks.block',
  'submit',
  'review.accept',
  'review.changes_requested',
  'review.reject',
];
export const readJSON = async (file) =>
  JSON.parse(await readFile(file, 'utf8'));
export async function saveJSON(
  file,
  value,
  { renameFile = rename, platform = process.platform } = {},
) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  // Windows readers/antivirus can briefly prevent atomic replacement. Retry
  // only that replacement: never remove the last durable destination first.
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(temporary, file);
      break;
    } catch (error) {
      if (
        platform !== 'win32' ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) ||
        attempt >= 5
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}
export function policyDirectory({ home, identity, endpoint, project }) {
  if (!isAbsolute(home) || !identity || !project)
    throw new Error('Explicit binding required');
  const key = createHash('sha256')
    .update(JSON.stringify([identity, new URL(endpoint).origin, project]))
    .digest('hex');
  return join(home, 'collaboration-background', key);
}
export function policyDigest(policy) {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex');
}
export async function validatePolicy(p) {
  const keys = [
    'version',
    'authorizationId',
    'home',
    'identity',
    'endpoint',
    'project',
    'workspace',
    'cliBinary',
    'host',
    'expiresAt',
    'maxTurns',
    'maxSeconds',
    'maxCostUsd',
    'allowedActions',
    'deliverProjectEvents',
    'instruction',
    'pollMilliseconds',
  ];
  if (!p || Object.keys(p).some((key) => !keys.includes(key)))
    throw new Error('Unknown policy field');
  for (const path of [p.home, p.workspace, p.cliBinary, p.host?.binary]) {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path)
      throw new Error('Canonical absolute paths required');
    await stat(path);
    if ((await realpath(path)).toLowerCase() !== path.toLowerCase())
      throw new Error('Linked policy paths are not supported');
  }
  if (
    !p.identity ||
    !p.project ||
    typeof p.identity !== 'string' ||
    typeof p.project !== 'string'
  )
    throw new Error('Identity and project required');
  const url = new URL(p.endpoint);
  if (
    url.origin !== p.endpoint ||
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('HTTPS origin required outside loopback');
  if (
    !['codex', 'claude_code', 'opencode'].includes(p.host.kind) ||
    Object.keys(p.host).some(
      (k) =>
        !(
          p.host.kind === 'opencode'
            ? [
                'kind',
                'binary',
                'model',
                'runtimeHome',
                'baseURL',
                'temperature',
              ]
            : p.host.kind === 'codex'
              ? ['kind', 'binary', 'serviceTier', 'bashPath', 'model']
              : ['kind', 'binary', 'serviceTier', 'bashPath', 'model']
        ).includes(k),
    )
  )
    throw new Error('Unsupported host configuration');
  if (
    ['codex', 'claude_code'].includes(p.host.kind) &&
    p.host.model !== undefined &&
    (typeof p.host.model !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(p.host.model))
  )
    throw new Error('Invalid explicit Codex model identifier');
  if (p.host.kind === 'opencode') {
    if (
      p.host.temperature !== undefined &&
      (!Number.isFinite(p.host.temperature) ||
        p.host.temperature < 0 ||
        p.host.temperature > 2)
    )
      throw new Error(
        'OpenCode temperature must be a finite number from 0 to 2',
      );
    const root = p.host.runtimeHome;
    if (
      typeof root !== 'string' ||
      !isAbsolute(root) ||
      resolve(root) !== root ||
      !(await stat(root)).isDirectory() ||
      (await realpath(root)).toLowerCase() !== root.toLowerCase()
    )
      throw new Error('Canonical isolated OpenCode home required');
    if (!/^elsewhere-local\/[a-zA-Z0-9._:-]+$/.test(p.host.model ?? ''))
      throw new Error('Explicit local OpenCode model required');
    const modelURL = new URL(p.host.baseURL);
    if (
      modelURL.protocol !== 'http:' ||
      modelURL.hostname !== '127.0.0.1' ||
      !modelURL.port ||
      modelURL.pathname !== '/v1' ||
      modelURL.search ||
      modelURL.hash ||
      modelURL.username ||
      modelURL.password
    )
      throw new Error('Explicit loopback OpenCode model endpoint required');
  }
  if (
    p.host.serviceTier !== undefined &&
    !['fast', 'flex'].includes(p.host.serviceTier)
  )
    throw new Error('Unsupported child service tier');
  if (
    p.host.bashPath !== undefined &&
    (!isAbsolute(p.host.bashPath) || !(await stat(p.host.bashPath)).isFile())
  )
    throw new Error('Invalid Bash path');
  if (
    !Number.isFinite(Date.parse(p.expiresAt)) ||
    Date.parse(p.expiresAt) <= Date.now()
  )
    throw new Error('Authorization expired');
  if (
    !Number.isSafeInteger(p.maxTurns) ||
    p.maxTurns < 1 ||
    p.maxTurns > 1000 ||
    !Number.isSafeInteger(p.maxSeconds) ||
    p.maxSeconds < 1 ||
    p.maxSeconds > 3600
  )
    throw new Error('Explicit bounded turn and time budgets required');
  if (!(p.maxCostUsd > 0) || !Number.isFinite(p.maxCostUsd))
    throw new Error('Explicit cost budget required');
  if (
    !Array.isArray(p.allowedActions) ||
    !p.allowedActions.includes('context') ||
    p.allowedActions.some((a) => !actionNames.includes(a)) ||
    new Set(p.allowedActions).size !== p.allowedActions.length
  )
    throw new Error('Invalid action allowlist');
  if (
    p.instruction !== undefined &&
    (typeof p.instruction !== 'string' || p.instruction.length > 16000)
  )
    throw new Error('Invalid owner instruction');
  if (
    p.pollMilliseconds !== undefined &&
    (!Number.isInteger(p.pollMilliseconds) || p.pollMilliseconds < 250)
  )
    throw new Error('Invalid poll interval');
  let credentials;
  try {
    credentials = await readJSON(join(p.home, 'collaboration-identity.json'));
    if (
      credentials.endpoint !== p.endpoint ||
      credentials.identity_kind !== 'installation_key'
    )
      throw new Error('Installation endpoint differs from authorization');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    credentials = await readJSON(
      join(p.home, 'servers', 'agentnet', 'agent-v2-credentials.json'),
    );
  }
  if (credentials.identity_kind === 'installation_key')
    await stat(join(p.home, 'collaboration-key.json'));
  if (credentials.agent_id !== p.identity)
    throw new Error('Existing Agent identity does not match authorization');
  return p;
}
export async function authorizePolicy(input) {
  const policy = await validatePolicy({
    ...input,
    version: 1,
    authorizationId: randomUUID(),
  });
  const directory = policyDirectory(policy);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await stat(join(directory, 'lock.json'));
    throw new Error('Stop the existing worker before reauthorizing');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const state = await readJSON(join(directory, 'state.json')).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (state?.pending || state?.status === 'quarantined')
    throw new Error(
      'Uncertain execution requires explicit local investigation; reauthorization cannot replay it',
    );
  await saveJSON(join(directory, 'policy.json'), policy);
  await saveJSON(join(directory, 'control.json'), {
    action: 'pause',
    authorizationId: policy.authorizationId,
  });
  return {
    policyFile: join(directory, 'policy.json'),
    authorizationId: policy.authorizationId,
  };
}
