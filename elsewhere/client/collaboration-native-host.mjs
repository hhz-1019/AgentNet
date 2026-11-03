import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { saveJSON } from './collaboration-background-policy.mjs';
import { executeOpenCodeTurn } from './collaboration-opencode-host.mjs';

const bridge = fileURLToPath(
  new URL('./collaboration-mcp.mjs', import.meta.url),
);
const groups = ['context', 'project', 'tasks', 'updates', 'submit', 'review'];
const scopedToolNames = groups.map((group) => `network_collaboration_${group}`);
const tools = groups.map((g) => `mcp__elsewhere__network_collaboration_${g}`);

// Only kill a process object created by this execution. Disk PIDs are never kill targets.
export async function terminateOwned(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Owned host exit was not confirmed')),
      10000,
    );
    child.once('exit', () => {
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
function launch(binary, args, policy, signal, onLine) {
  const javascript = /\.(?:mjs|cjs|js)$/i.test(binary);
  const child = spawn(
    javascript ? process.execPath : binary,
    javascript ? [binary, ...args] : args,
    {
      cwd: policy.workspace,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(policy.host.bashPath
          ? { CLAUDE_CODE_GIT_BASH_PATH: policy.host.bashPath }
          : {}),
      },
    },
  );
  let bytes = 0,
    failure;
  const diagnostics = { exitCode: null, category: null };
  const lines = createInterface({ input: child.stdout });
  const abort = () => {
    failure = new Error('Host execution interrupted');
    void terminateOwned(child).catch(() => {});
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  lines.on('line', (line) => {
    if (bytes > 8 * 1024 * 1024) return abort();
    try {
      onLine(JSON.parse(line), child);
    } catch (error) {
      diagnostics.category =
        error.message === 'Wrong native session'
          ? 'session_mismatch'
          : 'invalid_protocol';
      failure = new Error('Invalid native host protocol');
      abort();
    }
  });
  child.stdout.on('data', (data) => {
    bytes += data.length;
    if (bytes > 8 * 1024 * 1024) abort();
  });
  child.stderr.on('data', (data) => {
    bytes += data.length;
    const text = data.toString();
    for (const [category, pattern] of [
      ['auth', /not logged in|authentication|unauthorized|login required/i],
      ['quota', /quota|rate.?limit|usage limit|insufficient credit/i],
      [
        'invalid_option',
        /unknown option|invalid option|invalid argument|error: option/i,
      ],
      ['bash', /git.bash|bash.*(?:not found|required|failed)/i],
      ['mcp', /mcp.*(?:error|failed|invalid)/i],
      ['native_shutdown_assertion', /uv.*assert|Assertion failed.*closing/i],
    ])
      if (pattern.test(text)) diagnostics.category = category;
    if (bytes > 8 * 1024 * 1024) abort();
  });
  // Never retain or print raw native stderr, tool text, or conversation output.
  const exited = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Native host could not start')));
    child.once('close', (code) => {
      diagnostics.exitCode = code;
      signal?.removeEventListener('abort', abort);
      lines.close();
      if (failure) {
        failure.ownedProcessesExited = true;
        reject(failure);
      } else resolve(code);
    });
  });
  return { child, exited, diagnostics };
}
function bridgeConfig(policy, policyFile, job) {
  return {
    command: process.execPath,
    args: [bridge],
    env: {
      AGENTNET_CLI: policy.cliBinary,
      AGENTNET_HOME: policy.home,
      AGENTNET_URL: policy.endpoint,
      ...(process.env.AGENTNET_PLUGIN_TEST_LOOPBACK === '1'
        ? { AGENTNET_PLUGIN_TEST_LOOPBACK: '1' }
        : {}),
      ELSEWHERE_COLLABORATION_POLICY: policyFile,
      ELSEWHERE_COLLABORATION_JOB: job.id,
    },
  };
}
export async function executeNativeTurn({
  policy,
  policyFile,
  directory,
  job,
  sessionId,
  prompt,
  signal,
  onSession,
}) {
  if (policy.host.kind === 'opencode')
    return executeOpenCodeTurn({
      policy,
      policyFile,
      directory,
      job,
      sessionId,
      prompt,
      signal,
      onSession,
    });
  if (policy.host.kind === 'claude_code')
    return claudeTurn({
      policy,
      policyFile,
      directory,
      job,
      sessionId,
      prompt,
      signal,
      onSession,
    });
  return codexTurn({
    policy,
    policyFile,
    job,
    sessionId,
    prompt,
    signal,
    onSession,
  });
}
async function claudeTurn({
  policy,
  policyFile,
  directory,
  job,
  sessionId,
  prompt,
  signal,
  onSession,
}) {
  const id = sessionId || randomUUID();
  if (!sessionId) await onSession(id);
  const configFile = join(directory, `mcp-${job.id}.json`);
  await saveJSON(configFile, {
    mcpServers: { elsewhere: bridgeConfig(policy, policyFile, job) },
  });
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'dontAsk',
    '--tools',
    '',
    '--allowedTools',
    tools.join(','),
    '--strict-mcp-config',
    '--mcp-config',
    configFile,
    '--setting-sources',
    'user',
    '--settings',
    '{"disableAllHooks":true}',
    '--max-turns',
    '24',
    '--max-budget-usd',
    String(job.remainingCostUsd),
    sessionId ? '--resume' : '--session-id',
    id,
  ];
  let result,
    seenSession = false,
    model;
  const observedTools = new Set();
  const { child, exited, diagnostics } = launch(
    policy.host.binary,
    args,
    policy,
    signal,
    (message) => {
      if (typeof message.error === 'string') {
        if (/auth|login|not_logged/i.test(message.error))
          diagnostics.category = 'auth';
        else if (/quota|rate_limit|usage_limit/i.test(message.error))
          diagnostics.category = 'quota';
      }
      if (message.session_id && message.session_id !== id)
        throw new Error('Wrong native session');
      if (message.session_id === id) seenSession = true;
      if (message.type === 'system' && message.subtype === 'init')
        model = message.model;
      for (const item of message.message?.content || [])
        if (item.type === 'tool_use') observedTools.add(item.name);
      if (message.type === 'result') result = message;
    },
  );
  child.stdin.end(prompt);
  let code;
  try {
    code = await exited;
  } catch (error) {
    error.nativeMetadata = {
      ...diagnostics,
      seenSession,
      resultSubtype: result?.subtype,
      resultIsError: result?.is_error,
      model,
      observedTools: [...observedTools],
    };
    throw error;
  }
  if (
    code !== 0 ||
    !seenSession ||
    !result ||
    result.is_error ||
    result.subtype !== 'success'
  ) {
    const error = new Error('Native Claude completion is uncertain');
    error.ownedProcessesExited = true;
    error.nativeMetadata = {
      ...diagnostics,
      seenSession,
      resultSubtype: result?.subtype,
      resultIsError: result?.is_error,
      model,
      observedTools: [...observedTools],
    };
    throw error;
  }
  const costUsd = result.total_cost_usd;
  if (!Number.isFinite(costUsd) || costUsd < 0)
    throw new Error('Native Claude cost receipt missing');
  return {
    sessionId: id,
    completed: true,
    costUsd,
    costBudgetSupported: true,
    model,
    observedTools: [...observedTools],
  };
}
async function codexTurn({
  policy,
  policyFile,
  job,
  sessionId,
  prompt,
  signal,
  onSession,
}) {
  let sequence = 0,
    completeResolve,
    completeReject;
  const pending = new Map();
  const complete = new Promise((resolve, reject) => {
    completeResolve = resolve;
    completeReject = reject;
  });
  // Attach immediately: exit/approval rejection may race an initialization response.
  void complete.catch(() => {});
  const args = await codexChildArguments(policy, policyFile, job);
  let expectedThread = sessionId,
    expectedTurn;
  const observedTools = new Set();
  let stage = 'initialize';
  let resolvedModel,
    serviceTierCleared = false,
    completedTurnStatus = null,
    lastError = null;
  const errorNotifications = [];
  const safeError = (error, willRetry) => {
    const names = [
      'contextWindowExceeded',
      'usageLimitExceeded',
      'serverOverloaded',
      'internalServerError',
      'unauthorized',
      'badRequest',
      'threadRollbackFailed',
      'sandboxError',
      'other',
      'httpConnectionFailed',
      'responseStreamConnectionFailed',
      'responseStreamDisconnected',
      'responseTooManyFailedAttempts',
      'activeTurnNotSteerable',
    ];
    const rawInfo = error?.codexErrorInfo;
    const variant =
      typeof rawInfo === 'string'
        ? rawInfo
        : rawInfo && typeof rawInfo === 'object'
          ? Object.keys(rawInfo)[0]
          : null;
    const info = names.includes(variant) ? variant : null;
    const rawStatus =
      rawInfo && typeof rawInfo === 'object'
        ? rawInfo[variant]?.httpStatusCode
        : null;
    const httpStatusCode =
      Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
        ? rawStatus
        : null;
    const message = typeof error?.message === 'string' ? error.message : '';
    let category = 'other';
    for (const [name, pattern] of [
      [
        'auth',
        /unauthorized|authentication|not logged in|login required|invalid.api.key/i,
      ],
      ['quota', /usage.?limit|quota|rate.?limit|too many requests/i],
      ['tls', /certificate|TLS|SSL/i],
      ['timeout', /timed?.?out|deadline/i],
      [
        'connectivity',
        /connection|connect|network|stream.*disconnect|error sending|failed to send|transport/i,
      ],
      [
        'model_unavailable',
        /model.*(?:not[ _-]?found|unavailable|unsupported|not supported|does not exist)|(?:unsupported|unavailable).*model/i,
      ],
      ['server', /overload|internal.server/i],
      ['context_limit', /context.window|context.length/i],
      ['request', /bad.request|invalid.request/i],
    ])
      if (pattern.test(`${info || ''} ${message}`)) {
        category = name;
        break;
      }
    if (httpStatusCode === 401 || httpStatusCode === 403) category = 'auth';
    else if (httpStatusCode === 429) category = 'quota';
    else if (httpStatusCode >= 500) category = 'server';
    return {
      category,
      codexErrorInfo: info,
      httpStatusCode,
      rpcCode: Number.isInteger(error?.code) ? error.code : null,
      ...(typeof willRetry === 'boolean' ? { willRetry } : {}),
    };
  };
  const { child, exited, diagnostics } = launch(
    policy.host.binary,
    args,
    policy,
    signal,
    (message, process) => {
      if (message.method && Object.hasOwn(message, 'id')) {
        process.stdin.write(
          JSON.stringify({
            id: message.id,
            error: {
              code: -32601,
              message:
                'Interactive approvals are disabled for this authorized background run',
            },
          }) + '\n',
        );
        completeReject(new Error('Native host requested interactive approval'));
        return;
      }
      if (Object.hasOwn(message, 'id')) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) {
          lastError = safeError(message.error);
          waiter.reject(new Error('Native RPC rejected'));
        } else waiter.resolve(message.result);
      }
      if (message.method === 'error') {
        const p = message.params || {};
        if (
          p.threadId === expectedThread &&
          (!expectedTurn || p.turnId === expectedTurn)
        ) {
          lastError = safeError(p.error, p.willRetry);
          if (errorNotifications.length < 10)
            errorNotifications.push(lastError);
          if (p.willRetry === false)
            completeReject(new Error('Native turn reported failure'));
        }
      }
      if (message.method === 'turn/completed') {
        const p = message.params;
        completedTurnStatus = [
          'completed',
          'failed',
          'interrupted',
          'inProgress',
        ].includes(p.turn?.status)
          ? p.turn.status
          : 'unknown';
        if (p.turn?.error) lastError = safeError(p.turn.error);
        if (
          p.threadId !== expectedThread ||
          (expectedTurn && p.turn?.id !== expectedTurn) ||
          p.turn?.status !== 'completed'
        )
          completeReject(new Error('Native completion mismatch'));
        else completeResolve(p.turn);
      }
      if (
        message.method === 'item/started' &&
        message.params?.item?.type === 'mcpToolCall'
      ) {
        const item = message.params.item;
        observedTools.add(`mcp__${item.server}__${item.tool}`);
      }
    },
  );
  void exited.then(
    () => {
      for (const w of pending.values())
        w.reject(new Error('Native host exited'));
      completeReject(new Error('Native host exited before completion'));
    },
    (error) => {
      for (const w of pending.values()) w.reject(error);
      completeReject(error);
    },
  );
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  try {
    await rpc('initialize', {
      clientInfo: { name: 'elsewhere-collaboration', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(
      JSON.stringify({ method: 'initialized', params: {} }) + '\n',
    );
    stage = 'config_read';
    const effective = await rpc('config/read', {
      cwd: policy.workspace,
      includeLayers: false,
    });
    for (const [name, value] of Object.entries(
      effective.config?.mcp_servers || {},
    ))
      if (name !== 'elsewhere' && value.enabled !== false)
        throw new Error('Unexpected enabled MCP server');
    const scoped = effective.config?.mcp_servers?.elsewhere;
    if (
      scoped?.default_tools_approval_mode !== 'prompt' ||
      !Array.isArray(scoped.enabled_tools) ||
      scoped.enabled_tools.length !== scopedToolNames.length ||
      new Set(scoped.enabled_tools).size !== scopedToolNames.length ||
      scoped.enabled_tools.some((name) => !scopedToolNames.includes(name)) ||
      scopedToolNames.some(
        (name) => scoped.tools?.[name]?.approval_mode !== 'approve',
      )
    )
      throw new Error('Scoped MCP approval policy was not applied');
    stage = sessionId ? 'thread_resume' : 'thread_start';
    const thread = await rpc(sessionId ? 'thread/resume' : 'thread/start', {
      ...(sessionId ? { threadId: sessionId } : {}),
      ...(policy.host.model !== undefined ? { model: policy.host.model } : {}),
      cwd: policy.workspace,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceTier: null,
      config: {
        'features.shell_tool': false,
        'features.apps': false,
        'features.multi_agent': false,
        'features.apply_patch_freeform': false,
        'features.view_image': false,
      },
    });
    resolvedModel =
      typeof thread.model === 'string' &&
      /^[A-Za-z0-9._:/-]{1,128}$/.test(thread.model)
        ? thread.model
        : undefined;
    // Older native versions report null; current versions resolve the cleared
    // preference to the ordinary "default" tier. Explicit paid tiers stay fenced.
    serviceTierCleared =
      thread.serviceTier == null || thread.serviceTier === 'default';
    if (policy.host.model !== undefined && thread.model !== policy.host.model) {
      lastError = {
        category: 'model_unavailable',
        codexErrorInfo: null,
        httpStatusCode: null,
        rpcCode: null,
      };
      throw new Error('Native resolved model does not match owner policy');
    }
    if (
      !thread.thread?.id ||
      (sessionId && thread.thread.id !== sessionId) ||
      !serviceTierCleared
    )
      throw new Error('Native thread binding or service tier mismatch');
    expectedThread = thread.thread.id;
    await onSession(expectedThread);
    stage = 'turn_start';
    const turn = await rpc('turn/start', {
      threadId: expectedThread,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      approvalPolicy: 'never',
      serviceTier: null,
    });
    expectedTurn = turn.turn?.id;
    if (!expectedTurn) throw new Error('Native turn identifier missing');
    stage = 'turn_completion';
    await complete;
    return {
      sessionId: expectedThread,
      completed: true,
      costUsd: null,
      costBudgetSupported: false,
      model: thread.model,
      observedTools: [...observedTools],
    };
  } catch (error) {
    await terminateOwned(child);
    await exited.catch(() => {});
    error.ownedProcessesExited = true;
    error.stage = stage;
    error.nativeMetadata = {
      exitCode: diagnostics.exitCode,
      model: resolvedModel,
      serviceTierCleared,
      observedTools: [...observedTools],
      completedTurnStatus,
      errorCategory: lastError?.category || diagnostics.category || 'other',
      codexErrorInfo: lastError?.codexErrorInfo || null,
      httpStatusCode: lastError?.httpStatusCode || null,
      rpcCode: lastError?.rpcCode ?? null,
      errorNotifications,
    };
    throw error;
  } finally {
    await terminateOwned(child);
    await exited.catch(() => {});
  }
}
async function inheritedMcpNames(workspace) {
  const files = new Set([
    join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'),
  ]);
  for (let path = workspace; ; path = dirname(path)) {
    files.add(join(path, '.codex', 'config.toml'));
    if (dirname(path) === path) break;
  }
  const names = new Set();
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch((e) => {
      if (e.code !== 'ENOENT') throw e;
      return '';
    });
    for (const match of text.matchAll(
      /^\s*\[\s*mcp_servers\.(?:"([^"\n]+)"|'([^'\n]+)'|([A-Za-z0-9_-]+))/gm,
    ))
      names.add(match[1] || match[2] || match[3]);
  }
  return names;
}
function toml(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  return `{${Object.entries(value)
    .map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`)
    .join(',')}}`;
}

export async function codexChildArguments(policy, policyFile, job) {
  const config = {
    ...bridgeConfig(policy, policyFile, job),
    // Owner authorization is enforced again by the project/action-scoped bridge.
    // Keep the server default restrictive and approve only these six named tools.
    default_tools_approval_mode: 'prompt',
    enabled_tools: scopedToolNames,
    tools: Object.fromEntries(
      scopedToolNames.map((name) => [name, { approval_mode: 'approve' }]),
    ),
  };
  const args = [
    'app-server',
    '-c',
    'mcp_servers={}',
    '-c',
    'features.shell_tool=false',
    '-c',
    'features.apps=false',
    '-c',
    'features.multi_agent=false',
    '-c',
    'features.apply_patch_freeform=false',
    '-c',
    'features.view_image=false',
    '-c',
    'features.hooks=false',
    '-c',
    'web_search="disabled"',
    '-c',
    'tools.view_image=false',
    '-c',
    `mcp_servers.elsewhere=${toml(config)}`,
  ];
  for (const name of await inheritedMcpNames(policy.workspace)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name))
      throw new Error('Inherited MCP name cannot be safely overridden');
    if (name !== 'elsewhere')
      args.push('-c', `mcp_servers.${name}.enabled=false`);
  }
  if (policy.host.serviceTier)
    args.push('-c', `service_tier="${policy.host.serviceTier}"`);
  return args;
}
