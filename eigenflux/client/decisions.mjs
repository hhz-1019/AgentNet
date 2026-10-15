import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

export const interruptedDecision = {
  summary: '宿主在执行中停止，结果未确认；没有自动重复执行。请先核对已有影响。',
};

// One durable journal entry per command. A lost receipt is retried, never the
// external action. Claims that outlive their host are quarantined server-side.
export async function processDecision(runtime, context, signal) {
  const { client, executor, journal } = runtime;
  if (!executor) return false;
  const pending = await client.pending_commands({
    command_type: 'attention_response',
    executor_id: executor.id,
  });
  if (!Array.isArray(pending.commands))
    throw new Error('Invalid decision queue');
  const command = pending.commands.find(
    (c) =>
      c.command_type === 'attention_response' &&
      c.payload?.context_ref?.moment?.executor_id === executor.id &&
      !journal.jobs[c.command_id],
  );
  if (!command || signal?.aborted) return false;
  const claim = await client.claim_command({
    command_id: command.command_id,
    executor_id: executor.id,
  });
  if (
    claim.command_id !== command.command_id ||
    !claim.claim_token ||
    !Number.isSafeInteger(claim.claim_epoch) ||
    !Number.isSafeInteger(claim.claim_until)
  )
    throw new Error('Invalid decision claim');
  const job = {
    phase: 'executing',
    completion: {
      command_id: command.command_id,
      command_type: 'attention_response',
      claim_token: claim.claim_token,
      claim_epoch: claim.claim_epoch,
      status: 'failed',
      result: interruptedDecision,
    },
  };
  journal.jobs[command.command_id] = job;
  await runtime.save();
  const stop = new AbortController();
  const abort = () => stop.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timer,
    leaseTimer,
    renewing = Promise.resolve();
  try {
    const payload = claim.payload;
    if (
      payload?.protocol_version !== 'agent_attention.v1' ||
      payload?.context_ref?.moment?.executor_id !== executor.id ||
      !payload.authorization_scope?.trim() ||
      !payload.attention_snapshot ||
      !Number.isSafeInteger(payload.expires_at) ||
      payload.expires_at <= Date.now()
    )
      throw new Error('Invalid or expired decision snapshot');
    const input = {
      command_id: claim.command_id,
      decision: payload,
      control_context: context.control_context,
      host_id: executor.id,
      machine: hostname(),
      endpoint: runtime.endpoint,
    };
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    job.input = input;
    await runtime.save();
    // Renew before starting as well: the queue lease may have aged in transit.
    const renew = async () => {
      await client.heartbeat();
      const next = await client.renew_command({
        ...job.completion,
        executor_id: executor.id,
      });
      if (
        !Number.isSafeInteger(next.claim_until) ||
        next.claim_until <= Date.now()
      )
        throw new Error('Decision lease lost');
      clearTimeout(leaseTimer);
      leaseTimer = setTimeout(
        () => stop.abort(new Error('Decision lease expired')),
        Math.max(1, next.claim_until - Date.now() - 1000),
      );
    };
    await renew();
    const again = () => {
      timer = setTimeout(() => {
        renewing = renew()
          .then(() => {
            if (!stop.signal.aborted) again();
          })
          .catch(() => stop.abort(new Error('Decision lease renewal failed')));
      }, 25000);
    };
    again();
    const result = await executor.execute(input, { signal: stop.signal });
    if (stop.signal.aborted) throw stop.signal.reason;
    if (
      !['completed', 'failed'].includes(result?.status) ||
      !result.summary?.trim() ||
      [...result.summary].length > 500 ||
      !result.session_id ||
      !result.evidence?.trim() ||
      [...result.evidence].length > 2000
    )
      throw new Error('Executor returned no verifiable receipt');
    job.completion.status = result.status;
    job.completion.result = {
      summary: result.summary,
      execution: {
        host_id: executor.id,
        session_id: result.session_id,
        input_hash: hash,
        evidence: result.evidence,
      },
    };
  } catch (error) {
    job.completion.result = {
      summary:
        error.code === 'CODEX_CONFIG_ERROR'
          ? 'Codex CLI 与当前配置不兼容，尚未开始执行。请升级 CLI 或为宿主指定兼容的 AGENTNET_CODEX_BINARY。'
          : '执行未完成或结果未确认；请核对执行记录后再决定。没有自动重复执行。',
    };
    runtime.log({
      event: 'decision_failed',
      command_id: command.command_id,
      reason: stop.signal.aborted ? 'aborted_or_fenced' : 'execution_error',
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(leaseTimer);
    stop.abort();
    await renewing;
    signal?.removeEventListener('abort', abort);
  }
  job.phase = 'ready';
  await runtime.save();
  await client.heartbeat();
  await runtime.flush(job);
  return true;
}
