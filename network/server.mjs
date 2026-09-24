import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed, mutate } from './model.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = resolve(
  process.env.AGENTNET_DATA_DIR || resolve(root, '.agentnet-demo'),
);
await mkdir(dataDir, { recursive: true });
const dataFile = resolve(dataDir, 'network.json');
let state;
try {
  state = JSON.parse(await readFile(dataFile, 'utf8'));
  if (state.version !== 1) throw Error('Unsupported network data version');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = seed();
  await writeFile(dataFile, JSON.stringify(state, null, 2));
}
const port = Number(process.env.PORT || 4317);
const production = process.argv.includes('--production');
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
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`).test(host)) {
      json(res, 403, { error: '仅允许本机访问。' });
      return;
    }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && url.pathname === '/api/network') {
        json(res, 200, state);
        return;
      }
      if (req.method !== 'POST' || url.pathname !== '/api/network') {
        json(res, 404, { error: '接口不存在。' });
        return;
      }
      if (
        req.headers.origin &&
        ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
          req.headers.origin,
        )
      ) {
        json(res, 403, { error: '不允许跨站请求。' });
        return;
      }
      if (!req.headers['content-type']?.startsWith('application/json')) {
        json(res, 415, { error: '需要 JSON 请求。' });
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16000) {
          json(res, 413, { error: '请求过大。' });
          return;
        }
        chunks.push(chunk);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        json(res, 400, { error: 'JSON 格式错误。' });
        return;
      }
      if (
        !input ||
        typeof input !== 'object' ||
        !input.payload ||
        typeof input.payload !== 'object' ||
        Array.isArray(input.payload)
      ) {
        json(res, 400, { error: '请求参数无效。' });
        return;
      }
      // ponytail: one local workspace, serialize atomic JSON writes; move to SQLite for multi-user access.
      const result = writes.then(async () => {
        const next = mutate(
          structuredClone(state),
          input.action,
          input.payload,
        );
        await writeFile(`${dataFile}.tmp`, JSON.stringify(next, null, 2));
        await rename(`${dataFile}.tmp`, dataFile);
        state = next;
        return next;
      });
      writes = result.catch(() => {});
      json(res, 200, await result);
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const dist = resolve(root, 'dist-network');
    let path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (path !== dist && !path.startsWith(dist + sep)) {
      json(res, 403, { error: '路径无效。' });
      return;
    }
    if (!extname(path)) path = resolve(dist, 'index.html');
    try {
      const data = await readFile(path);
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
          }[extname(path)] || 'application/octet-stream',
      });
      res.end(data);
    } catch {
      json(res, 404, { error: '文件不存在。' });
    }
  } catch (error) {
    json(res, error.status || 500, {
      error: error.status ? error.message : '保存失败，请重试。',
    });
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `AgentNet ${production ? 'production' : 'demo'}: http://127.0.0.1:${port}`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      await vite?.close();
      process.exit(0);
    }),
  );
