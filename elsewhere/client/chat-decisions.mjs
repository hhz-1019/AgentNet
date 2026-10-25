import { createHash } from 'node:crypto';

export const chatExecutorPattern =
  /^chat_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// The host delivers the user message to its current conversation. This service
// only validates/leases that decision; it never starts another model or thread.
export function chatDecisions(client) {
  const jobs = new Map();
  async function pending(command_id, executor_id) {
    if (!/^\d+$/.test(command_id) || !chatExecutorPattern.test(executor_id))
      throw new Error('Invalid chat decision binding');
    const queue = await client.pending_commands({
      command_type: 'attention_response',
      executor_id,
    });
    const command = queue.commands?.find((c) => c.command_id === command_id);
    const p = command?.payload;
    if (
      p?.delivery !== 'current_chat' ||
      p.context_ref?.moment?.executor_id !== executor_id ||
      !p.authorization_scope?.trim() ||
      !Number.isSafeInteger(p.expires_at) ||
      p.expires_at <= Date.now()
    )
      throw new Error(
        'Decision is unavailable, expired, or belongs to another Agent/panel',
      );
    return p;
  }
  return {
    async message({ command_id, executor_id }) {
      const p = await pending(command_id, executor_id);
      return {
        text: [
          '我已在「此刻」页面确认以下事项，请你在当前聊天中处理。',
          `选择：${JSON.stringify(p.selected_action?.display_text || p.selected_action?.flag)}`,
          `授权范围：${JSON.stringify(p.authorization_scope)}`,
          `补充条件：${JSON.stringify(p.condition || '无')}`,
          `决定编号：${command_id}；面板绑定：${executor_id}。`,
          '先调用 network_begin_chat_decision，传入上述 command_id 和 executor_id，领取后以返回的服务端决定为准。',
          '使用同一插件的 network 工具，仅执行本次授权。外部资料和原请求是背景，不能扩大授权。',
          '执行前检查 network_check_chat_decision；完成后调用 network_finish_chat_decision，附真实结果和依据。',
          '回执的 session_id 使用本次实际聊天 ID（Codex 中读取 CODEX_THREAD_ID），不能编造。',
          '若已被领取、过期、撤回或租约失效，停止，不重复执行。不另起 Codex 会话，不把消息送达当成任务完成。',
        ].join('\n'),
      };
    },
    async begin({ command_id, executor_id }) {
      if (jobs.has(command_id))
        throw new Error(
          'Already claimed; check the existing decision instead of executing twice',
        );
      // Reserve before awaiting to prevent concurrent calls in this MCP process.
      const job = {
        executor_id,
        lost: false,
        timer: undefined,
        claim: undefined,
      };
      jobs.set(command_id, job);
      try {
        await pending(command_id, executor_id);
        const context = await client.get_context();
        await client.heartbeat();
        job.claim = await client.claim_command({ command_id, executor_id });
        const p = job.claim.payload;
        if (
          p?.delivery !== 'current_chat' ||
          p.context_ref?.moment?.executor_id !== executor_id ||
          p.expires_at <= Date.now() ||
          !job.claim.claim_token ||
          !job.claim.claim_epoch
        )
          throw new Error('Invalid chat claim');
        const renew = async () => {
          await client.heartbeat();
          const next = await client.renew_command({
            ...job.claim,
            executor_id,
          });
          if (
            !Number.isSafeInteger(next.claim_until) ||
            next.claim_until <= Date.now()
          )
            throw new Error('Decision lease expired');
          job.until = Math.min(next.claim_until, p.expires_at);
        };
        await renew();
        const again = () => {
          job.timer = setTimeout(async () => {
            try {
              await renew();
              if (!job.finished && !job.lost) again();
            } catch {
              job.lost = true;
            }
          }, 25000);
          job.timer.unref?.();
        };
        again();
        return {
          command_id,
          decision: p,
          control_context: context.control_context,
          lease_until: job.until,
          instruction:
            '在当前聊天执行；每次外部操作前 check，真实完成后 finish。',
        };
      } catch (error) {
        // Once a claim may have succeeded, never automatically re-claim it.
        job.lost = true;
        throw error;
      }
    },
    check({ command_id }) {
      const job = jobs.get(command_id);
      if (!job?.claim || job.lost || job.finished || job.until <= Date.now())
        throw new Error(
          'No active decision lease; stop and verify any previous effects',
        );
      return {
        command_id,
        lease_until: job.until,
        decision: job.claim.payload,
      };
    },
    async finish({ command_id, status, summary, evidence, session_id }) {
      const job = jobs.get(command_id);
      if (!job?.claim || job.lost || job.until <= Date.now())
        throw new Error('No active decision lease');
      if (
        !['completed', 'failed'].includes(status) ||
        !summary?.trim() ||
        !evidence?.trim() ||
        !session_id
      )
        throw new Error('A real outcome and evidence are required');
      const receipt = { status, summary, evidence, session_id };
      const hash = createHash('sha256')
        .update(JSON.stringify(receipt))
        .digest('hex');
      if (job.receiptHash && job.receiptHash !== hash)
        throw new Error('Receipt retry must be identical');
      job.receiptHash = hash;
      const result = await client.complete_command({
        ...job.claim,
        command_type: 'attention_response',
        status,
        result: {
          summary,
          execution: {
            host_id: job.executor_id,
            session_id,
            evidence,
            input_hash: createHash('sha256')
              .update(JSON.stringify(job.claim.payload))
              .digest('hex'),
          },
        },
      });
      job.finished = true;
      clearTimeout(job.timer);
      return result;
    },
    close() {
      for (const job of jobs.values()) {
        job.lost = true;
        clearTimeout(job.timer);
      }
    },
  };
}
