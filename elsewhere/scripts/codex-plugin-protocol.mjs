// Native Codex app-server client for local plugin acceptance, not a replacement installer.
import { spawn, execFile } from 'node:child_process';
export async function codexProtocol({
  binary,
  env = process.env,
  cwd = process.cwd(),
  overrides = [],
}) {
  const child = spawn(
    binary,
    ['app-server', ...overrides.flatMap((value) => ['-c', value])],
    {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let sequence = 0,
    buffer = '';
  const pending = new Map();
  const notifications = [];
  child.stderr.resume();
  const ended = new Promise((done) => child.once('close', done));
  child.stdout.on('data', (bytes) => {
    buffer += bytes;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const p = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(p.timer);
        if (message.error) p.reject(new Error(JSON.stringify(message.error)));
        else p.resolve(message.result);
      } else notifications.push(message);
    }
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, 120000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  const fail = (error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };
  child.on('error', fail);
  child.on('close', () => fail(new Error('Codex app-server exited')));
  await request('initialize', {
    clientInfo: {
      name: 'elsewhere_plugin_acceptance',
      version: '0.0.54-agentnet.30',
    },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  return {
    request,
    notifications,
    async close() {
      child.stdin.end();
      let timer;
      const clean = await Promise.race([
        ended.then(() => true),
        new Promise((done) => {
          timer = setTimeout(() => done(false), 5000);
        }),
      ]);
      clearTimeout(timer);
      if (!clean && child.pid) {
        // Kill only this client's owned app-server tree, never a desktop process or stored PID.
        if (process.platform === 'win32')
          await new Promise((done) =>
            execFile(
              'taskkill.exe',
              ['/PID', String(child.pid), '/T', '/F'],
              { windowsHide: true },
              done,
            ),
          );
        else child.kill('SIGTERM');
        await ended;
      }
    },
  };
}
