import { randomUUID } from 'node:crypto';
import { secretInDraft } from './work.mjs';
import { generationIdentity } from './identity.mjs';
import { expressionContext } from './prompts.mjs';

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
  let plan = await client.activity_tool({ tool: 'plan' });
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
      evidence: [],
      completed: [],
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
      result = { rejected: true, code: error.apiCode, message: error.result?.error?.message };
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
    const observation =
      tool === 'plan'
        ? (({
            identity_core: _identity,
            activity_contract: _contract,
            tools: _tools,
            ...rest
          }) => rest)(result)
        : result;
    state.results.push({
      tool,
      arguments: args,
      result: observation,
      ...(readback ? { readback } : {}),
    });
    state.results = state.results.slice(-4);
    if (!result.rejected) {
      if (['sources', 'read', 'post', 'observations'].includes(tool)) {
        state.evidence ||= [];
        state.evidence.push({ tool, arguments: args, result });
        state.evidence = state.evidence.slice(-6);
      }
      if (spec.write) {
        state.completed ||= [];
        state.completed.push({ tool, result });
        state.completed = state.completed.slice(-12);
      }
    }
    delete state.inflight;
    state.step++;
    await save();
    return result;
  };
  if (state.inflight) {
    // Exact request replay after a crash; no model call selects new content.
    const { tool, ...args } = state.inflight;
    await invoke(tool, args);
    plan = await client.activity_tool({ tool: 'plan' });
  }
  const maxSteps = Math.max(8, Math.min(24, plan.runtime?.max_steps || 8));
  let continuation = await client.activity_tool({
    tool: 'recall',
    scope: 'public',
  });
  let { identity_core, activity_contract, ...settings } = plan;
  state.evidence ||= [];
  state.completed ||= [];
  let formatFeedback;
  let completionFeedback;
  let completionChecked = false;
  for (; state.step < maxSteps && !signal?.aborted;) {
    let decision;
    try {
      decision = await model.json(
        identity_core + '\n' + expressionContext + '\n' + activity_contract,
        {
          activity_plan: settings,
          agent_identity: generationIdentity(
            identity || plan.agent_profile,
            'activity',
          ),
          companion_voice: voice,
          continuation,
          records,
          tools: plan.tools,
          steps_remaining: maxSteps - state.step,
          tool_results: state.results,
          evidence: state.evidence,
          completed: state.completed,
          format_feedback: formatFeedback,
          completion_feedback: completionFeedback,
        },
        { signal },
      );
    } catch (error) {
      if (
        !formatFeedback &&
        /Model must return complete JSON content/.test(error.message)
      ) {
        formatFeedback =
          '上次未返回完整 JSON，没有执行动作。请只输出一个简短完整的 action=tool 或 action=skip JSON 对象。';
        continue;
      }
      throw error;
    }
    if (secretInDraft(decision)) throw new Error('Invalid activity content');
    if (decision.action === 'skip') {
      if (
        !completionChecked &&
        settings.round_objectives?.publish_target > 0 &&
        !state.completed.some((x) => x.tool === 'publish')
      ) {
        completionChecked = true;
        completionFeedback =
          '本轮分享目标尚未完成。回到已确认的目的与依据：可以把具体需求发给网络，或分享查证所得，不必等待新新闻。确有权限、预算或资料阻塞时记录阻塞，不能编造或重复凑数。';
        continue;
      }
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
    ) {
      if (formatFeedback)
        throw new Error('Activity requires a tool or completion');
      formatFeedback =
        '只返回 action=tool、tool 和 arguments，或 action=skip 和 pending。上次格式未执行任何动作。';
      continue;
    }
    formatFeedback = undefined;
    const args = { ...decision.arguments };
    // This public round receives only curated public host records.
    if (['recall', 'checkpoint'].includes(decision.tool)) args.scope = 'public';
    const result = await invoke(decision.tool, args);
    if (!result.rejected) {
      if (['review', 'publish', 'plan'].includes(decision.tool)) {
        plan =
          decision.tool === 'plan'
            ? result
            : await client.activity_tool({ tool: 'plan' });
        ({ identity_core, activity_contract, ...settings } = plan);
      }
      await save();
    }
    if (['recall', 'checkpoint'].includes(decision.tool) && !result.rejected)
      continuation = await client.activity_tool({
        tool: 'recall',
        scope: 'public',
      });
  }
  if (
    !state.completed.some((x) => x.tool === 'checkpoint') &&
    !signal?.aborted
  ) {
    const current = await client.activity_tool({
      tool: 'recall',
      scope: 'public',
    });
    const done = state.completed
      .filter((x) => x.tool !== 'image')
      .map((x) => `${x.tool}:${x.result.id || x.result.revision || 'ok'}`)
      .join('、');
    await invoke('checkpoint', {
      scope: 'public',
      data: {
        revision: current.revision,
        pending: done
          ? `本轮已有回执：${done}。下轮先检查这些行动的回应，再继续当前目的。`
          : '本轮尚无成功动作回执，下轮恢复当前目的与待办后继续。',
        next_check_at: now + 2 * 3600000,
      },
    });
  }
  state.done = true;
  const latest = await client.activity_tool({
    tool: 'recall',
    scope: 'public',
  });
  state.nextAt = Math.max(
    now + 5 * 60000,
    latest.next_check_at > now ? latest.next_check_at : now + 2 * 3600000,
  );
  await save();
  return { receipts: state.results, nextAt: state.nextAt };
}
