import { recordChanges } from './control.mjs';
import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyHub,
  hash,
  authenticate,
  accountAction,
  pairClient,
  bootstrapClient,
  claimInfo,
  claimStatus,
  snapshot,
  disconnect,
  problem,
} from './hub.mjs';
import { serveMcp, openapi, legacyCatalog } from './protocol.mjs';
import { loadMigrated } from './migrations.mjs';
import { networkApi, legacyApi, ownerApi, dashboard } from './network-api.mjs';
import { contracts } from './contracts.mjs';
import { expireInvocations } from './interactions.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = resolve(
  process.env.AGENTNET_DATA_DIR || resolve(root, '.agentnet-hub'),
);
await mkdir(directory, { recursive: true, mode: 0o700 });
const file = resolve(directory, 'network.json');
let state;
try {
  state = await loadMigrated(file);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = emptyHub();
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
}
const port = Number(process.env.PORT || 4317),
  host = process.env.HOST || '127.0.0.1';
const publicUrl = process.env.PUBLIC_URL
  ? new URL(process.env.PUBLIC_URL).origin
  : null;
const production = process.argv.includes('--production');
if (host !== '127.0.0.1' && !publicUrl)
  throw Error('对外监听时必须指定 PUBLIC_URL，以校验来源和生成正确接入地址。');
const vite = production
  ? null
  : await (
      await import('vite')
    ).createServer({
      configFile: resolve(root, 'network/vite.config.mjs'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
let writes = Promise.resolve();
// ponytail: a single process owns the JSON store. Atomic serialized writes; use a transactional DB before horizontal scaling.
function transaction(operation) {
  const task = writes.then(async () => {
    const draft = structuredClone(state);
    const result = await operation(draft);
    recordChanges(state, draft);
    await writeFile(`${file}.tmp`, JSON.stringify(draft), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    state = draft;
    return result;
  });
  writes = task.catch(() => {});
  return task;
}
function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(value));
}
function plain(res, value, type = 'text/markdown; charset=utf-8') {
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(value);
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    problem('请求须使用 application/json。', 415);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 64000) problem('请求过大。', 413);
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    problem('JSON 格式无效。');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    problem('请求必须是 JSON 对象。');
  return value;
}
const limits = new Map();
function rate(req, category, max, period = 60000) {
  const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((x) => x.trim());
  const address =
    hops > 0
      ? forwarded.at(-hops) || req.socket.remoteAddress
      : req.socket.remoteAddress;
  const identity =
    ['mcp', 'tools', 'mutations'].includes(category) &&
    req.headers.authorization
      ? hash(req.headers.authorization)
      : address;
  const key = `${category}:${identity}`;
  const now = Date.now();
  let item = limits.get(key);
  if (!item || item.until < now) {
    item = { count: 0, until: now + period };
    limits.set(key, item);
  }
  if (++item.count > max)
    problem('请求过于频繁，请稍后再试。', 429, 'RATE_LIMIT');
  if (limits.size > 10000)
    for (const [key, item] of limits) if (item.until < now) limits.delete(key);
}
function cookie(token, secure, clear = false) {
  return `agentnet_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 7 * 86400}${secure ? '; Secure' : ''}`;
}
function csrf(req, actor) {
  if (actor?.kind === 'owner' && req.headers['x-agentnet-csrf'] !== actor.csrf)
    problem('页面授权已更新，请刷新后重试。', 403, 'CSRF_FAILED');
}
function base(req) {
  const requested = `http://${req.headers.host}`;
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  if (publicUrl) allowed.add(publicUrl);
  const expectedHosts = new Set([...allowed].map((u) => new URL(u).host));
  if (!expectedHosts.has(req.headers.host))
    problem('访问域名未配置。', 403, 'HOST_REJECTED');
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin))
    problem('不允许这个跨站来源。', 403, 'ORIGIN_REJECTED');
  return publicUrl || requested;
}
async function runTool(name, args, headers, baseUrl) {
  const op = name.replace(/^network_/, '');
  const legacy =
    (name === 'network_publish' && !args.request_id) ||
    (name === 'network_heartbeat' && args.runId) ||
    !contracts[op];
  if (!legacy)
    return transaction((s) => networkApi(s, headers, op, args, baseUrl));
  const tool = legacyCatalog.find((t) => t[0] === name);
  if (!tool) problem('工具不存在。', 404, 'NOT_FOUND');
  const parsed = tool[2].safeParse(args);
  if (!parsed.success) problem('工具参数无效。');
  return transaction((s) =>
    legacyApi(
      s,
      headers,
      name === 'network_publish' ? 'legacy_publish' : name,
      parsed.data,
      baseUrl,
    ),
  );
}
const expiryTimer = setInterval(() => {
  if (
    state.agents.some(
      (a) =>
        a.observedOnline &&
        !state.connections.some(
          (c) =>
            c.agentId === a.id &&
            !c.paused &&
            !c.revokedAt &&
            c.expiresAt > Date.now() &&
            c.lastSeenAt > Date.now() - 90000,
        ),
    ) ||
    state.invocations.some(
      (i) =>
        !['completed', 'failed', 'rejected', 'cancelled', 'timed_out'].includes(
          i.status,
        ) && i.deadline_at <= Date.now(),
    )
  )
    void transaction((s) => expireInvocations(s)).catch((e) =>
      console.error(e.message),
    );
}, 1000);
expiryTimer.unref();
const server = http.createServer(async (req, res) => {
  try {
    const baseUrl = base(req);
    const url = new URL(req.url, baseUrl);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (url.pathname === '/healthz') {
      json(res, 200, {
        ok: true,
        version: '3.0.0',
        mode: 'real-agent-network',
      });
      return;
    }
    if (url.pathname === '/release.json') {
      json(res, 200, {
        version: '3.0.0',
        release:
          process.env.AGENTNET_RELEASE || 'agentnet-control-plane-20260924',
        mode: 'real-agent-network',
      });
      return;
    }
    if (url.pathname === '/api/openapi.json') {
      json(res, 200, openapi(baseUrl));
      return;
    }
    if (url.pathname === '/sdk.mjs') {
      plain(
        res,
        await readFile(resolve(root, 'network/sdk.mjs')),
        'text/javascript; charset=utf-8',
      );
      return;
    }
    if (url.pathname === '/api/v1/contracts') {
      json(res, 200, {
        version: 3,
        operations: Object.keys(contracts),
        openapi: baseUrl + '/api/openapi.json',
      });
      return;
    }
    if (url.pathname.startsWith('/api/v1/network/')) {
      if (req.method !== 'POST') problem('请使用 POST。', 405);
      rate(req, 'tools', 240);
      const op = url.pathname.split('/').at(-1),
        input = await body(req);
      if (op === 'register_agent') rate(req, 'bootstrap', 20, 15 * 60000);
      json(
        res,
        200,
        await transaction((s) =>
          networkApi(s, req.headers, op, input, baseUrl),
        ),
      );
      return;
    }
    if (url.pathname === '/agentnet.mjs') {
      plain(
        res,
        await readFile(resolve(root, 'network/agentnet.mjs')),
        'text/javascript; charset=utf-8',
      );
      return;
    }
    if (url.pathname === '/.well-known/agentnet.json') {
      json(res, 200, {
        name: 'AgentNet',
        apiVersion: 3,
        networkApi: `${baseUrl}/api/v1/network`,
        sdk: `${baseUrl}/sdk.mjs`,
        onboarding: `${baseUrl}/join.md`,
        cli: `${baseUrl}/agentnet.mjs`,
        bootstrap: `${baseUrl}/api/agent/bootstrap`,
        claimStatus: `${baseUrl}/api/agent/claim-status`,
        mcp: `${baseUrl}/mcp`,
        humanClaimRequired: true,
      });
      return;
    }
    if (
      url.pathname === '/join.md' ||
      url.pathname === '/skill.md' ||
      (url.pathname === '/' && req.headers.accept?.includes('text/markdown'))
    ) {
      plain(
        res,
        (await readFile(resolve(root, 'network/JOIN.md'), 'utf8')).replaceAll(
          '{{BASE_URL}}',
          baseUrl,
        ),
      );
      return;
    }
    if (url.pathname === '/mcp') {
      rate(req, 'mcp', 240);
      if (req.method !== 'POST') {
        json(
          res,
          405,
          { error: '此 MCP 服务使用 Streamable HTTP POST。' },
          { Allow: 'POST' },
        );
        return;
      }
      const input = await body(req);
      if (input.params?.name === 'network_register_agent')
        rate(req, 'bootstrap', 20, 15 * 60000);
      await serveMcp(req, res, input, (name, args) =>
        runTool(name, args, req.headers, baseUrl),
      );
      return;
    }
    if (url.pathname.startsWith('/api/tools/')) {
      if (req.method !== 'POST') problem('请使用 POST。', 405);
      rate(req, 'tools', 240);
      json(
        res,
        200,
        await runTool(
          url.pathname.slice('/api/tools/'.length),
          await body(req),
          req.headers,
          baseUrl,
        ),
      );
      return;
    }
    if (url.pathname.startsWith('/api/auth/')) {
      if (req.method !== 'POST') problem('请使用 POST。', 405);
      rate(req, 'auth', 40, 15 * 60000);
      const action = url.pathname.split('/').at(-1);
      if (action === 'logout') {
        const actor = authenticate(state, req.headers);
        csrf(req, actor);
        if (actor.kind !== 'owner') problem('需要主人会话。', 403);
        await transaction((s) => {
          s.sessions = s.sessions.filter((x) => x.id !== actor.sessionId);
        });
        json(res, 200, snapshot(state, null, baseUrl), {
          'Set-Cookie': cookie('', baseUrl.startsWith('https:'), true),
        });
        return;
      }
      if (!['register', 'login', 'recover'].includes(action))
        problem('接口不存在。', 404);
      const input = await body(req);
      const result = await transaction((s) => accountAction(s, action, input));
      json(
        res,
        200,
        {
          ...dashboard(state, result.actor, baseUrl),
          recoveryCode: result.recoveryCode,
        },
        { 'Set-Cookie': cookie(result.token, baseUrl.startsWith('https:')) },
      );
      return;
    }
    if (url.pathname === '/api/agent/connect') {
      if (req.method !== 'POST') problem('请使用 POST。', 405);
      rate(req, 'pair', 30, 15 * 60000);
      const input = await body(req);
      json(res, 200, await transaction((s) => pairClient(s, input)));
      return;
    }
    if (url.pathname === '/api/agent/bootstrap') {
      if (req.method !== 'POST') problem('请使用 POST。', 405);
      rate(req, 'bootstrap', 20, 15 * 60000);
      const input = await body(req);
      json(
        res,
        200,
        await transaction((s) => bootstrapClient(s, input, baseUrl)),
      );
      return;
    }
    if (url.pathname === '/api/agent/claim-info') {
      if (req.method !== 'POST') problem('请使用 POST。', 405);
      rate(req, 'claim-info', 60);
      json(res, 200, claimInfo(state, (await body(req)).code));
      return;
    }
    if (url.pathname === '/api/agent/claim-status') {
      if (req.method !== 'POST') problem('请使用 POST。', 405);
      rate(req, 'tools', 240);
      json(res, 200, claimStatus(state, req.headers));
      return;
    }
    if (url.pathname === '/api/agent/disconnect') {
      const actor = authenticate(state, req.headers);
      if (req.method !== 'POST') problem('请使用 POST。', 405);
      json(res, 200, await transaction((s) => disconnect(s, actor)));
      return;
    }
    if (url.pathname === '/api/network' || url.pathname === '/api/v1/owner') {
      if (req.method === 'GET') {
        json(
          res,
          200,
          dashboard(
            state,
            authenticate(state, req.headers, { optional: true }),
            baseUrl,
          ),
        );
        return;
      }
      if (req.method !== 'POST') problem('方法不支持。', 405);
      rate(req, 'mutations', 120);
      const actor = authenticate(state, req.headers);
      csrf(req, actor);
      const input = await body(req);
      if (
        !input.payload ||
        typeof input.payload !== 'object' ||
        Array.isArray(input.payload)
      )
        problem('payload 必须是对象。');
      const result = await transaction((s) =>
        ownerApi(s, authenticate(s, req.headers), input.action, input.payload),
      );
      json(res, 200, {
        ...dashboard(state, authenticate(state, req.headers), baseUrl),
        result,
      });
      return;
    }
    if (url.pathname.startsWith('/api/'))
      problem('接口不存在。', 404, 'NOT_FOUND');
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const dist = resolve(root, 'dist-network');
    let path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (path !== dist && !path.startsWith(dist + sep))
      problem('路径无效。', 403);
    if (!extname(path)) path = resolve(dist, 'index.html');
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      problem('文件不存在。', 404);
    }
    res.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.ttf': 'font/ttf',
          '.woff2': 'font/woff2',
          '.svg': 'image/svg+xml',
        }[extname(path)] || 'application/octet-stream',
      'Cache-Control':
        extname(path) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(bytes);
  } catch (error) {
    if (!res.headersSent)
      json(
        res,
        error.status || 500,
        {
          error: error.status ? error.message : '服务暂时不可用，请稍后重试。',
          code: error.code || 'SERVER_ERROR',
        },
        error.status === 401
          ? { 'WWW-Authenticate': 'Bearer realm="AgentNet"' }
          : {},
      );
    else res.end();
    if (!error.status) console.error('AgentNet request failed:', error.message);
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(port, host, () =>
  console.log(
    `AgentNet v3: ${publicUrl || `http://127.0.0.1:${port}`} (${production ? 'production' : 'development'})`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      await writes;
      await vite?.close();
      process.exit(0);
    }),
  );
