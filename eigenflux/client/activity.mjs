import { randomUUID } from 'node:crypto';
import { secretInDraft } from './work.mjs';

// Hosts differ in model and memory adapters. All observations and mutations use
// the same server registry and receipts as the platform host.
export async function runActivityRound({
  client,
  model,
  state,
  save,
  records = [],
  identity,
  voice,
  signal,
  now = Date.now(),
}) {
  if (state.nextAt > now && !state.inflight) return { deferred: true };
  const plan = await client.activity_tool({ tool: 'plan' });
  if (
    !plan.settings ||
    !plan.identity_core ||
    !plan.activity_contract ||
    !plan.tools
  )
    throw new Error('Unsupported activity contract');
  if (plan.permissions && !Object.values(plan.permissions).some(Boolean))
    return { unauthorized: true };
  const hour = new Date(now + 8 * 3600000).getUTCHours();
  if (hour < plan.settings.start_hour || hour >= plan.settings.end_hour)
    return { outsideHours: true };
  if (!plan.identity_core || !plan.activity_contract || !plan.tools)
    throw new Error('Unsupported activity contract');
  if (!state.round || state.done)
    Object.assign(state, {
      round: randomUUID(),
      step: 0,
      results: [],
      done: false,
    });
  const invoke = async (tool, args) => {
    const spec = plan.tools[tool];
    if (!spec) throw new Error('Unknown activity capability');
    if (spec.write) {
      args = { ...args, key: `host:${state.round}:${state.step}` };
      state.inflight = { ...args, tool };
      await save();
    }
    let result;
    try {
      result = await client.activity_tool({ ...args, tool });
    } catch (error) {
      // An explicit rejection is a tool observation; a lost response remains
      // unresolved and is replayed with the same key on the next host start.
      if (!error.apiCode) throw error;
      result = { rejected: true, code: error.apiCode };
    }
    // Never reconstruct a publication receipt from model prose.
    if (
      tool === 'publish' &&
      !result.rejected &&
      (!/^\d+$/.test(result.id) || result.state !== 'published')
    )
      throw new Error('Publication receipt incomplete');
    const readback =
      tool === 'publish' && !result.rejected
        ? await client.activity_tool({ tool: 'post', id: result.id })
        : undefined;
    state.results.push({
      tool,
      arguments: args,
      result,
      ...(readback ? { readback } : {}),
    });
    state.results = state.results.slice(-4);
    delete state.inflight;
    state.step++;
    await save();
    return result;
  };
  if (state.inflight) {
    // Exact request replay after a crash; no model call selects new content.
    const { tool, ...args } = state.inflight;
    await invoke(tool, args);
  }
  const continuation = await client.activity_tool({
    tool: 'recall',
    scope: 'public',
  });
  const { identity_core, activity_contract, ...settings } = plan;
  for (; state.step < 8 && !signal?.aborted;) {
    const decision = await model.json(
      identity_core + '\n' + activity_contract,
      {
        activity_plan: settings,
        agent_identity: identity,
        companion_voice: voice,
        continuation,
        records,
        tools: plan.tools,
        tool_results: state.results,
      },
      { signal },
    );
    if (secretInDraft(decision)) throw new Error('Invalid activity content');
    if (decision.action === 'skip') {
      if (decision.pending) {
        const current = await client.activity_tool({
          tool: 'recall',
          scope: 'public',
        });
        await invoke('checkpoint', {
          scope: 'public',
          data: {
            revision: current.revision,
            pending: decision.pending,
            next_check_at: now + 2 * 3600000,
          },
        });
      }
      break;
    }
    if (
      decision.action !== 'tool' ||
      !decision.arguments ||
      typeof decision.arguments !== 'object'
    )
      throw new Error('Activity requires a tool or completion');
    const args = { ...decision.arguments };
    // This public round receives only curated public host records.
    if (['recall', 'checkpoint'].includes(decision.tool)) args.scope = 'public';
    await invoke(decision.tool, args);
  }
  state.done = true;
  const latest = await client.activity_tool({
    tool: 'recall',
    scope: 'public',
  });
  state.nextAt = Math.max(
    now + 5 * 60000,
    latest.next_check_at || now + 2 * 3600000,
  );
  await save();
  return { receipts: state.results, nextAt: state.nextAt };
}
