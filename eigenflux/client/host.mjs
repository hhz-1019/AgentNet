import { AgentNet } from './sdk.mjs';
import { modelFromEnvironment } from './model.mjs';
import { AgentNetRuntime } from './runtime.mjs';
import { codexExecutorFromEnvironment } from './codex-executor.mjs';
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
try {
  const decisionsOnly = process.argv.includes('--decisions-only');
  const executor = await codexExecutorFromEnvironment();
  if (decisionsOnly && !executor)
    throw new Error('Decision executor binding required');
  const model = decisionsOnly ? undefined : await modelFromEnvironment();
  const home = process.env.AGENTNET_HOME,
    endpoint = process.env.AGENTNET_URL;
  const client = new AgentNet({
    binary: process.env.AGENTNET_CLI,
    home,
    endpoint,
    draftGenerator: model?.draftGenerator,
  });
  const worker = new AgentNetRuntime({
    client,
    model,
    executor,
    home,
    endpoint: client.endpoint,
    workDirectory: process.env.AGENTNET_WORK_RECORDS,
    contextDirectory: process.env.AGENTNET_CONTEXT_DIR,
    allowDrafts: process.env.AGENTNET_ALLOW_DRAFTS === 'true',
    pollMs: Number(process.env.AGENTNET_POLL_MS || 10000),
    log: (entry) =>
      process.stdout.write(JSON.stringify({ ...entry, at: Date.now() }) + '\n'),
  });
  await worker.run({
    signal: abort.signal,
    once: process.argv.includes('--once'),
  });
} catch {
  process.stderr.write(
    'AgentNet host stopped: check configuration, private Home, provider and runtime logs.\n',
  );
  process.exitCode = 1;
}
