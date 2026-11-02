import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  readJSON,
  saveJSON,
  validatePolicy,
  policyDirectory,
  policyDigest,
} from './collaboration-background-policy.mjs';

export async function loadBridgeAuthorization(policyFile, jobId) {
  const policy = await validatePolicy(await readJSON(policyFile));
  const directory = policyDirectory(policy);
  const orphan = await readJSON(join(directory, `orphan-${jobId}.json`)).catch(
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    },
  );
  if (orphan) throw new Error('Execution scheduler disconnected');
  if (resolve(policyFile) !== join(directory, 'policy.json'))
    throw new Error('Noncanonical authorization file');
  const state = await readJSON(join(directory, 'state.json'));
  if (!Number.isSafeInteger(state.pid) || state.pid < 1)
    throw new Error('Execution scheduler identity missing');
  try {
    process.kill(state.pid, 0);
  } catch {
    throw new Error('Execution scheduler is no longer running');
  }
  const control = await readJSON(join(directory, 'control.json'));
  if (
    state.status !== 'running' ||
    state.pending?.id !== jobId ||
    state.policyDigest !== policyDigest(policy) ||
    control.authorizationId !== policy.authorizationId ||
    !['start', 'resume'].includes(control.action)
  )
    throw new Error('Background authorization is not active');
  if (
    Date.now() >= state.pending.deadline ||
    state.turns > policy.maxTurns ||
    state.costUsd >= policy.maxCostUsd
  )
    throw new Error('Background budget exhausted');
  return { policy, directory, state };
}
export function assertGrant(project, policy) {
  const member = project?.members?.[policy.identity];
  if (
    project?.project_id !== policy.project ||
    !member ||
    member.state !== 'active' ||
    !member.scopes?.includes('read') ||
    (member.expires_at && member.expires_at <= Date.now())
  )
    throw new Error('Active bound project membership required');
  return project;
}
export function createBackgroundBridge(client, policyFile, jobId) {
  let queue = Promise.resolve();
  return (group, args) => {
    const next = queue.then(async () => {
      const { policy, directory } = await loadBridgeAuthorization(
        policyFile,
        jobId,
      );
      const action = group + (args.action ? '.' + args.action : '');
      if (
        args.project_id !== policy.project ||
        !policy.allowedActions.includes(action)
      )
        throw new Error('Action outside local project authorization');
      if (
        client.endpoint !== policy.endpoint ||
        resolve(client.cliHome || client.home) !== policy.home ||
        resolve(client.binary) !== policy.cliBinary
      )
        throw new Error('Bridge identity transport mismatch');
      const context = await client.collaboration_context({
        project_id: policy.project,
      });
      await loadBridgeAuthorization(policyFile, jobId);
      const project = assertGrant(context.project, policy);
      if (
        project.state !== 'active' &&
        ![
          'context',
          'project.get',
          'tasks.get',
          'tasks.list',
          'updates.read',
        ].includes(action)
      )
        throw new Error('Project is not active');
      const receiptFile = join(directory, `receipt-${jobId}.json`);
      const receipt = await readJSON(receiptFile);
      const request = { ...args };
      if (action === 'tasks.start')
        request.host = `elsewhere-background:${jobId}`;
      if (['tasks.heartbeat', 'tasks.block', 'submit'].includes(action)) {
        const lease = receipt.leases.find(
          (r) =>
            r.task_id === args.task_id &&
            r.epoch === args.epoch &&
            r.host === `elsewhere-background:${jobId}`,
        );
        if (!lease) throw new Error('Execution does not own this task lease');
      }
      if (
        args.task_id &&
        (group === 'submit' ||
          [
            'tasks.accept',
            'tasks.start',
            'tasks.heartbeat',
            'tasks.block',
          ].includes(action)) &&
        project.tasks?.[args.task_id]?.assignee !== policy.identity
      )
        throw new Error('Assigned task required');
      if (
        group === 'review' &&
        project.tasks?.[args.task_id]?.reviewer !== policy.identity
      )
        throw new Error('Assigned reviewer required');
      const call = {
        id: randomUUID(),
        action,
        task_id: args.task_id,
        status: 'pending',
        idempotency_key: args.idempotency_key,
      };
      receipt.calls.push(call);
      await saveJSON(receiptFile, receipt);
      let result;
      try {
        await loadBridgeAuthorization(policyFile, jobId);
        result = await client[`collaboration_${group}`](request);
      } catch (error) {
        // An identical idempotency key/payload can safely resolve a lost transport reply.
        // Version conflicts are returned to the model, which must read fresh context.
        if (args.idempotency_key && !error.apiCode) {
          await loadBridgeAuthorization(policyFile, jobId);
          result = await client[`collaboration_${group}`](request);
        } else {
          call.status =
            error.apiCode || !args.idempotency_key ? 'rejected' : 'pending';
          await saveJSON(receiptFile, receipt);
          throw error;
        }
      }
      call.status = 'completed';
      if (action === 'tasks.start') {
        const task = result.project?.tasks?.[args.task_id];
        if (
          !task ||
          task.state !== 'running' ||
          !Number.isSafeInteger(task.epoch)
        )
          throw new Error('Started lease receipt missing');
        receipt.leases.push({
          task_id: args.task_id,
          epoch: task.epoch,
          host: request.host,
        });
      }
      if (action === 'submit' || action === 'tasks.block')
        receipt.leases = receipt.leases.filter(
          (r) => r.task_id !== args.task_id,
        );
      await saveJSON(receiptFile, receipt);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  };
}
