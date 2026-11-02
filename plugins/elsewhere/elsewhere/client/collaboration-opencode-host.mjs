import { spawn } from 'node:child_process';
import { mkdir, writeFile, lstat, readdir, mkdtemp } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { saveJSON } from './collaboration-background-policy.mjs';

const groups = ['context', 'project', 'tasks', 'updates', 'submit', 'review'];
const bridge = fileURLToPath(
  new URL('./collaboration-mcp.mjs', import.meta.url),
);
export function openCodeConfiguration(host) {
  const url = new URL(host.baseURL);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/v1' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Explicit loopback model endpoint required');
  if (!/^elsewhere-local\/[a-zA-Z0-9._:-]+$/.test(host.model))
    throw new Error('Explicit local model required');
  const model = host.model.slice('elsewhere-local/'.length);
  return {
    model: host.model,
    update: 'disable',
    snapshots: false,
    plugins: ['-opencode.tool.skill'],
    permissions: [
      { action: '*', resource: '*', effect: 'deny' },
      ...groups.map((g) => ({
        action: `elsewhere_network_collaboration_${g}`,
        resource: '*',
        effect: 'allow',
      })),
    ],
    policies: [
      { action: 'provider.use', resource: '*', effect: 'deny' },
      { action: 'provider.use', resource: 'elsewhere-local', effect: 'allow' },
      { action: 'plugin.use', resource: '*', effect: 'deny' },
      { action: 'skill.use', resource: '*', effect: 'deny' },
      { action: 'mcp.use', resource: '*', effect: 'deny' },
      { action: 'mcp.use', resource: 'elsewhere', effect: 'allow' },
      { action: 'integration.use', resource: '*', effect: 'deny' },
      { action: 'integration.connect', resource: '*', effect: 'deny' },
      {
        action: 'integration.use',
        resource: 'elsewhere-local',
        effect: 'allow',
      },
      { action: 'tool.use', resource: '*', effect: 'deny' },
      ...groups.map((g) => ({
        action: 'tool.use',
        resource: `elsewhere_network_collaboration_${g}:*`,
        effect: 'allow',
      })),
    ],
    providers: {
      'elsewhere-local': {
        name: 'Owner-authorized local model',
        env: [],
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: url.href, timeout: 90000 },
        models: {
          [model]: {
            name: model,
            limit: { context: 16384, output: 4096 },
            capabilities: { tools: true, input: ['text'], output: ['text'] },
            body: {
              reasoning_effort: 'none',
              ...(host.temperature !== undefined
                ? { temperature: host.temperature }
                : {}),
            },
          },
        },
      },
    },
  };
}

export async function assertOpenCodeManagedConfigAbsent(
  managedRoot = join(process.env.ProgramData || 'C:\\ProgramData', 'opencode'),
) {
  let info;
  try {
    info = await lstat(managedRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error('OpenCode managed configuration cannot be verified');
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(
      'OpenCode managed configuration prevents isolated execution',
    );
  let entries;
  try {
    entries = await readdir(managedRoot);
  } catch {
    throw new Error('OpenCode managed configuration cannot be verified');
  }
  if (entries.length)
    throw new Error(
      'OpenCode managed configuration prevents isolated execution',
    );
}

export async function openCodeEnvironment(root) {
  // Never sidestep an existing machine administrator's configuration by redirecting it.
  await assertOpenCodeManagedConfigAbsent();
  if (!isAbsolute(root))
    throw new Error('Absolute isolated runtime home required');
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error('Plain isolated OpenCode home required');
  for (const name of ['data', 'state']) {
    const target = join(root, name);
    try {
      await mkdir(target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Linked OpenCode session storage is not supported');
  }
  const execution = await mkdtemp(join(root, 'execution-'));
  const env = {};
  // No inherited auth, OpenCode options, Node hooks, shell hooks or provider keys.
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC'])
    if (process.env[key]) env[key] = process.env[key];
  const paths = {
    USERPROFILE: join(execution, 'home'),
    HOME: join(execution, 'home'),
    APPDATA: join(execution, 'roaming'),
    LOCALAPPDATA: join(execution, 'local'),
    ProgramData: join(execution, 'system'),
    TEMP: join(execution, 'temp'),
    TMP: join(execution, 'temp'),
    XDG_DATA_HOME: join(root, 'data'),
    XDG_CONFIG_HOME: join(execution, 'config'),
    XDG_CACHE_HOME: join(execution, 'cache'),
    XDG_STATE_HOME: join(root, 'state'),
    OPENCODE_TEST_HOME: join(execution, 'home'),
    OPENCODE_CONFIG_DIR: join(execution, 'config', 'opencode'),
  };
  for (const path of new Set(Object.values(paths)))
    await mkdir(path, { recursive: true });
  const gitConfig = join(execution, 'empty-gitconfig');
  const hooks = join(execution, 'empty-hooks');
  await writeFile(gitConfig, '', { mode: 0o600 });
  await mkdir(hooks, { recursive: true });
  return {
    ...env,
    ...paths,
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_PURE: '1',
    OPENCODE_DISABLE_FREE_MODELS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: hooks,
    GIT_CONFIG_KEY_1: 'core.fsmonitor',
    GIT_CONFIG_VALUE_1: 'false',
  };
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Owned OpenCode exit unconfirmed')),
      10000,
    );
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    if (process.platform === 'win32') {
      const killer = spawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
      killer.on('error', () => child.kill());
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  });
}

export function createOpenCodeRpc(child, onUpdate) {
  let next = 1,
    bytes = 0,
    failed;
  const pending = new Map();
  const fail = (category) => {
    if (failed) return;
    failed = Object.assign(new Error('OpenCode native turn failed'), {
      nativeMetadata: { category },
    });
    for (const p of pending.values()) p.reject(failed);
    pending.clear();
    void stop(child).catch(() => {});
  };
  const send = (message) =>
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const lines = createInterface({ input: child.stdout });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      bytes += data.length;
      if (bytes > 8 * 1024 * 1024) fail('output_limit');
    });
  lines.on('line', (line) => {
    if (failed) return;
    try {
      const message = JSON.parse(line);
      if (message.jsonrpc !== '2.0') return fail('invalid_protocol');
      if (message.method && message.id !== undefined) {
        // Never grant permissions or client filesystem/terminal access.
        if (message.method === 'session/request_permission')
          send({
            id: message.id,
            result: { outcome: { outcome: 'cancelled' } },
          });
        else
          send({
            id: message.id,
            error: { code: -32601, message: 'Unsupported client capability' },
          });
      } else if (message.id !== undefined) {
        const p = pending.get(message.id);
        if (!p) return fail('unexpected_response');
        pending.delete(message.id);
        if (message.error) {
          p.reject(
            Object.assign(new Error('OpenCode request rejected'), {
              nativeMetadata: {
                category: 'native_request_error',
                code: message.error.code,
              },
            }),
          );
        } else p.resolve(message.result);
      } else if (message.method === 'session/update') onUpdate(message.params);
    } catch {
      fail('invalid_protocol');
    }
  });
  child.once('error', () => fail('start_failed'));
  child.once('close', () => {
    lines.close();
    if (pending.size) fail('early_exit');
  });
  child.stdin.on('error', () => fail('input_closed'));
  return {
    request(method, params) {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve, reject });
        send({ id, method, params });
      });
    },
    fail,
  };
}

export async function bindOpenCodeSession(rpc, params, sessionId, onSession) {
  if (sessionId) {
    if (!/^ses_[A-Za-z0-9]+$/.test(sessionId))
      throw new Error('Invalid OpenCode session');
    await rpc.request('session/resume', { ...params, sessionId });
    return sessionId;
  }
  const created = await rpc.request('session/new', params);
  if (
    typeof created?.sessionId !== 'string' ||
    !/^ses_[A-Za-z0-9]+$/.test(created.sessionId)
  )
    throw new Error('Invalid OpenCode session');
  await onSession(created.sessionId);
  return created.sessionId;
}

export function openCodeBridgeConfiguration(policy, policyFile, job) {
  return {
    servers: {
      elsewhere: {
        type: 'local',
        codemode: false,
        command: [process.execPath, bridge],
        environment: {
          AGENTNET_CLI: policy.cliBinary,
          AGENTNET_HOME: policy.home,
          AGENTNET_URL: policy.endpoint,
          ELSEWHERE_COLLABORATION_POLICY: policyFile,
          ELSEWHERE_COLLABORATION_JOB: job.id,
        },
      },
    },
  };
}

export function waitForOpenCodeMcp(child, signal) {
  return new Promise((resolve, reject) => {
    let buffer = '',
      settle;
    const cleanup = () => {
      clearTimeout(settle);
      child.stderr.removeListener('data', data);
      child.removeListener('close', closed);
      child.removeListener('error', closed);
      signal?.removeEventListener('abort', aborted);
    };
    const fail = (category) => {
      cleanup();
      reject(
        Object.assign(new Error('OpenCode MCP readiness failed'), {
          nativeMetadata: { category },
        }),
      );
    };
    const closed = () => fail('mcp_start_failed');
    const aborted = () => fail('interrupted');
    const data = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop().slice(-65536);
      for (const line of lines) {
        if (
          !/message="mcp connected"/.test(line) ||
          !/\bserver=elsewhere\b/.test(line)
        )
          continue;
        const count = /\btools=(\d+)\b/.exec(line)?.[1];
        if (count !== '6') return fail('mcp_inventory_mismatch');
        // OpenCode 2.2.5 reloads the tool registry 100ms after its connected event.
        // session/new and its initial registry flush can return before this event.
        clearTimeout(settle);
        settle = setTimeout(() => {
          cleanup();
          resolve();
        }, 250);
      }
    };
    child.stderr.on('data', data);
    child.once('close', closed);
    child.once('error', closed);
    if (signal?.aborted) aborted();
    else signal?.addEventListener('abort', aborted, { once: true });
  });
}

export async function executeOpenCodeTurn({
  policy,
  policyFile,
  job,
  sessionId,
  prompt,
  signal,
  onSession,
}) {
  // This adapter's machine-config isolation was verified on Windows only.
  // Unix /etc/opencode and macOS managed preferences need a separate adapter audit.
  if (process.platform !== 'win32')
    throw new Error('OpenCode native adapter currently requires Windows');
  if (signal?.aborted) throw new Error('OpenCode turn interrupted');
  const env = await openCodeEnvironment(policy.host.runtimeHome);
  if (signal?.aborted) throw new Error('OpenCode turn interrupted');
  await saveJSON(join(env.OPENCODE_CONFIG_DIR, 'opencode.json'), {
    ...openCodeConfiguration(policy.host),
    mcp: openCodeBridgeConfiguration(policy, policyFile, job),
  });
  if (signal?.aborted) throw new Error('OpenCode turn interrupted');
  const child = spawn(policy.host.binary, ['--print-logs', 'acp'], {
    cwd: policy.workspace,
    env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const mcpReady = waitForOpenCodeMcp(child, signal);
  // A startup failure may reject readiness while initialize is still awaiting a response.
  void mcpReady.catch(() => {});
  let id = sessionId,
    sawText = false,
    prompting = false,
    failure,
    phase = 'initialize',
    stopReason = null;
  const observedTools = new Set();
  const rpc = createOpenCodeRpc(child, ({ sessionId: observed, update }) => {
    if (id && observed !== id) throw new Error('Wrong native session');
    if (update?._meta?.['opencode/child-session'])
      throw new Error('Unexpected child session');
    if (!prompting) return;
    if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.text)
      sawText = true;
    if (update?.sessionUpdate === 'tool_call') {
      const name = update.name;
      if (
        !groups.some(
          (group) => name === `elsewhere_network_collaboration_${group}`,
        )
      )
        throw new Error('Unexpected native tool');
      for (const group of groups)
        if (name === `elsewhere_network_collaboration_${group}`)
          observedTools.add(`mcp__elsewhere__network_collaboration_${group}`);
    }
  });
  const abort = () => rpc.fail('interrupted');
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => rpc.fail('timeout'), policy.maxSeconds * 1000);
  try {
    const initialized = await rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    });
    if (
      initialized?.protocolVersion !== 1 ||
      initialized.agentInfo?.name !== 'OpenCode' ||
      initialized.agentInfo?.version !== '2.2.5' ||
      !initialized.agentCapabilities?.sessionCapabilities?.resume
    )
      throw new Error('Unsupported OpenCode protocol');
    const params = {
      cwd: policy.workspace,
      additionalDirectories: [],
      // ACP injection replaces the whole server configuration and loses codemode:false.
      // The fresh native configuration above binds exactly this job's MCP server.
      mcpServers: [],
    };
    // Durable binding before model execution or external actions.
    phase = sessionId ? 'session_resume' : 'session_create';
    id = await bindOpenCodeSession(rpc, params, sessionId, onSession);
    phase = 'model_select';
    const selected = await rpc.request('session/set_config_option', {
      sessionId: id,
      configId: 'model',
      value: policy.host.model,
    });
    if (
      selected?.configOptions?.find((option) => option.id === 'model')
        ?.currentValue !== policy.host.model
    )
      throw new Error('OpenCode model selection mismatch');
    phase = 'mcp_ready';
    await mcpReady;
    if (signal?.aborted) throw new Error('OpenCode turn interrupted');
    prompting = true;
    phase = 'prompt';
    const result = await rpc.request('session/prompt', {
      sessionId: id,
      prompt: [{ type: 'text', text: prompt }],
    });
    stopReason = [
      'end_turn',
      'cancelled',
      'max_tokens',
      'max_turn_requests',
      'refusal',
    ].includes(result?.stopReason)
      ? result.stopReason
      : 'unknown';
    if (stopReason !== 'end_turn' || (!sawText && !observedTools.size))
      throw new Error('OpenCode did not complete its turn');
    return {
      sessionId: id,
      completed: true,
      costUsd: 0,
      costBudgetSupported: false,
      model: policy.host.model,
      observedTools: [...observedTools],
      usage: Object.fromEntries(
        ['inputTokens', 'outputTokens', 'totalTokens']
          .filter(
            (key) =>
              Number.isFinite(result.usage?.[key]) && result.usage[key] >= 0,
          )
          .map((key) => [key, result.usage[key]]),
      ),
    };
  } catch (error) {
    failure = error;
    error.stage = 'host_execution';
    error.nativeMetadata = {
      ...error.nativeMetadata,
      phase,
      stopReason,
      model: policy.host.model,
      observedTools: [...observedTools],
    };
    error.observedTools = [...observedTools];
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await stop(child);
    if (failure) failure.ownedProcessesExited = true;
  }
}
