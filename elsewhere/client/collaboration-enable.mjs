#!/usr/bin/env node
// Run only in response to the local owner's explicit background-execution request.
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existingCollaborationClient, collaborationIdentity } from './collaboration-identity.mjs';
import {
  authorizePolicy,
  startBackground,
} from './collaboration-background.mjs';
export async function enable({
  connection,
  project,
  workspace = process.cwd(),
  hours = 4,
  turns = 8,
}) {
  if (
    !project ||
    !Number.isInteger(Number(hours)) ||
    Number(hours) < 1 ||
    Number(hours) > 24 ||
    !Number.isInteger(Number(turns)) ||
    Number(turns) < 1 ||
    Number(turns) > 32
  )
    throw new Error('Specify a project, 1–24 hours and 1–32 turns.');
  const saved = JSON.parse(await readFile(resolve(connection), 'utf8'));
  if (saved.host !== 'codex' || !saved.hostBinary)
    throw new Error('This shortcut currently supports installed Codex only.');
  const client = await existingCollaborationClient({
    binary: await realpath(saved.cli),
    home: await realpath(saved.home),
    endpoint: saved.endpoint,
  });
  await client.connect();
  const identity = await collaborationIdentity(client);
  const context = await client.collaboration_context({ project_id: project });
  if (context.project?.members?.[identity]?.state !== 'active')
    throw new Error('Accept the project before enabling background work.');
  const policy = {
    home: client.cliHome,
    identity: String(identity),
    endpoint: client.endpoint,
    project,
    workspace: await realpath(resolve(workspace)),
    cliBinary: client.binary,
    host: { kind: 'codex', binary: await realpath(saved.hostBinary) },
    expiresAt: new Date(Date.now() + Number(hours) * 3600000).toISOString(),
    maxTurns: Number(turns),
    maxSeconds: 420,
    maxCostUsd: 2,
    allowedActions: [
      'context',
      'project.get',
      'project.complete',
      'updates.read',
      'tasks.list',
      'tasks.get',
      'tasks.accept',
      'tasks.start',
      'tasks.heartbeat',
      'tasks.block',
      'submit',
      'review.accept',
      'review.changes_requested',
      'review.reject',
    ],
    deliverProjectEvents: context.project.creator === String(identity),
    instruction:
      'Complete the locally authorized assigned tasks and exact-version reviews. Share only the authorized project results. Report concrete blockers; never claim a future action as completed.',
  };
  await authorizePolicy(policy);
  await startBackground(policy);
  return {
    startRequested: true,
    project,
    expiresAt: policy.expiresAt,
    maxTurns: policy.maxTurns,
    maxSeconds: policy.maxSeconds,
    costBudgetSupported: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      if (
        ![
          '--connection',
          '--project',
          '--workspace',
          '--hours',
          '--turns',
        ].includes(key) ||
        !process.argv[i + 1]
      )
        throw new Error('Invalid background setup argument');
      args[key.slice(2)] = process.argv[i + 1];
    }
    console.log(JSON.stringify(await enable(args), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
