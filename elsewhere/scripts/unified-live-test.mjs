// Real model decisions + real public retrieval + isolated PostgreSQL writes.
// No canned decision list, production token, or production database is used.
import { mkdir, readFile, writeFile, rm, appendFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { runActivityRound } from '../client/activity.mjs';
import { CompatibleModel } from '../client/model.mjs';
import { verifyUnifiedResults } from './unified-live-results.mjs';
const dir = resolve(
  process.env.AGENTNET_UNIFIED_REPORT_DIR || '.agentnet-audit/unified-live',
);
await mkdir(dir, { recursive: true });
await rm(resolve(dir, 'ready.json'), { force: true });
const token = randomBytes(24).toString('hex');
const identityPath = process.env.AGENTNET_UNIFIED_IDENTITY_FILE;
if (!identityPath)
  throw Error('Provide the real host identity file explicitly');
const identity = JSON.parse(await readFile(identityPath, 'utf8'));
const hostRecords = [
  {
    source: 'host:companion-identity',
    updated_at: identity.updated_at,
    intent: identity.intent,
    character: identity.character,
  },
];
await writeFile(
  resolve(dir, 'host-input.json'),
  JSON.stringify({ identity, records: hostRecords }, null, 2),
  { mode: 0o600 },
);
const log = createWriteStream(resolve(dir, 'backend.log'));
const child = spawn(
  process.execPath,
  ['elsewhere/scripts/managed-core-test.mjs', '--unified-provider'],
  {
    env: {
      ...process.env,
      AGENTNET_UNIFIED_LIVE: 'true',
      AGENTNET_UNIFIED_REPORT_DIR: dir,
      AGENTNET_UNIFIED_TEST_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.pipe(log);
child.stderr.pipe(log);
let ended = false;
const exited = new Promise((resolve) =>
  child.once('exit', (code) => {
    ended = true;
    resolve(code);
  }),
);
let ready;
for (let i = 0; i < 240; i++) {
  try {
    ready = JSON.parse(await readFile(resolve(dir, 'ready.json'), 'utf8'));
    break;
  } catch {}
  if (ended) throw Error('Fixture failed; inspect backend.log');
  await delay(500);
}
if (!ready) {
  child.kill();
  throw Error('Fixture startup timeout');
}
const invoke = async (path, body) => {
  const r = await fetch(ready.url + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const value = await r.json();
  if (!r.ok) {
    const e = new Error('Tool HTTP ' + r.status);
    e.apiCode = value.error?.code || value.code || 'TEST_TOOL_REJECTED';
    e.result = value;
    throw e;
  }
  return value.data ?? value;
};
const baseModel = new CompatibleModel({
  baseURL: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
  apiKey: process.env.LLM_API_KEY,
  timeoutMs: 90000,
  onResponse: (r) =>
    appendFile(
      resolve(dir, 'user-responses.ndjson'),
      JSON.stringify(r) + '\n',
      { mode: 0o600 },
    ),
});
const userTrace = [],
  userTools = [],
  rounds = [];
const model = {
  async json(system, input, opts) {
    await writeFile(
      resolve(dir, 'user-last-input.json'),
      JSON.stringify({ system, input }, null, 2),
      { mode: 0o600 },
    );
    const output = await baseModel.json(system, input, opts);
    userTrace.push(structuredClone({ input, output }));
    await writeFile(
      resolve(dir, 'user-model.json'),
      JSON.stringify(userTrace, null, 2),
      { mode: 0o600 },
    );
    return output;
  },
};
const state = {};
const actor = ready.actors.find((a) => a.kind === 'user');
const client = {
  async activity_tool({ tool, ...request }) {
    try {
      const result = await invoke('/tool', {
        agent_id: actor.id,
        tool,
        request,
      });
      userTools.push({ tool, request, result });
      return result;
    } catch (e) {
      userTools.push({ tool, request, error: e.result });
      throw e;
    }
  },
};
try {
  for (let round = 1; round <= 2; round++) {
    for (const item of ready.actors) {
      console.log('round', round, item.kind, 'started');
      try {
        let result;
        if (item.kind === 'user') {
          // Explicit test trigger advances no clock and does not pretend two hours elapsed.
          state.nextAt = 0;
          result = await runActivityRound({
            client,
            model,
            state,
            save: () =>
              writeFile(
                resolve(dir, 'user-state.json'),
                JSON.stringify(state, null, 2),
                { mode: 0o600 },
              ),
            records: hostRecords,
            identity,
          });
        } else result = await invoke('/round', { agent_id: item.id });
        rounds.push({ round, ...item, result });
      } catch (e) {
        rounds.push({ round, ...item, error: e.message });
      }
      await writeFile(
        resolve(dir, 'rounds.json'),
        JSON.stringify(rounds, null, 2),
        { mode: 0o600 },
      );
      console.log('round', round, item.kind, 'finished');
    }
  }
} finally {
  await writeFile(
    resolve(dir, 'user-tools.json'),
    JSON.stringify(userTools, null, 2),
    { mode: 0o600 },
  );
  await invoke('/finish', {});
  const code = await exited;
  if (code !== 0) process.exitCode = code;
}
console.log('Isolated acceptance saved:', dir);
const acceptance = await verifyUnifiedResults(dir);
console.log(
  'Behavior acceptance:',
  acceptance.passed ? 'passed' : 'incomplete',
);
if (!acceptance.passed) process.exitCode = 1;
