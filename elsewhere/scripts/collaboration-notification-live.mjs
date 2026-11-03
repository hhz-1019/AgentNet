// Public-backend, real-host acceptance. Owner approval is a separate manual step.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { detectRuntime } from '../client/collaboration-runtime.mjs';
import {
  readStatus,
  controlBackground,
} from '../client/collaboration-background.mjs';
import { InstallationClient } from '../client/collaboration-identity.mjs';
import { configureAutopilot } from '../client/collaboration-autopilot.mjs';

const [action, rootArg, extra] = process.argv.slice(2);
if (!rootArg)
  throw Error(
    'Usage: prepare|inbox|bind|approve|status|finish AUDIT_DIRECTORY [automation_id|--owner-approved]',
  );
const root = resolve(rootArg);
const file = join(root, 'notification-live.json');
await mkdir(root, { recursive: true });
const save = (s) => writeFile(file, JSON.stringify(s, null, 2));
let state = await readFile(file, 'utf8').then(JSON.parse, (e) => {
  if (e.code !== 'ENOENT') throw e;
  return null;
});
const cli = resolve(
  '.agentnet-audit/bin/agentnet-collaboration-background.exe',
);
const endpoint = 'https://collab.gongshi.world';
async function mcp(index, operation) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('elsewhere/client/collaboration-plugin.mjs')],
    env: {
      ...process.env,
      AGENTNET_HOME: join(root, 'identity-' + index),
      AGENTNET_URL: endpoint,
      AGENTNET_CLI: cli,
      AGENTNET_HOST_KIND: 'codex',
      AGENTNET_HOST_BINARY: state.binary,
    },
    stderr: 'pipe',
  });
  const client = new Client({
    name: 'elsewhere-owner-notification-acceptance',
    version: '1',
  });
  try {
    await client.connect(transport);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError)
        throw Error(
          'MCP operation rejected: ' +
            name +
            ' ' +
            JSON.stringify(result.content),
        );
      return JSON.parse(result.content[0].text);
    };
    return await operation(call);
  } finally {
    await client.close();
  }
}
function nativeClient(index) {
  const client = new InstallationClient({
    home: join(root, 'identity-' + index),
    endpoint,
    binary: cli,
  });
  client.hostKind = 'codex';
  client.hostBinary = state.binary;
  return client;
}
if (action === 'prepare') {
  if (state)
    throw Error(
      'Existing test state preserved. Continue inbox/status; do not create replacement identities.',
    );
  state = {
    version: '0.0.54-agentnet.37',
    createdAt: new Date().toISOString(),
    binary: await detectRuntime('codex'),
    endpoint,
    identities: [],
    passed: false,
    ownerApproved: false,
  };
  await save(state);
  for (let i = 0; i < 2; i++) {
    await mkdir(join(root, 'workspace-' + i), { recursive: true });
    state.identities[i] = await mcp(i, (call) =>
      call('elsewhere_connection', {
        action: 'status',
        display_name: i ? 'Elsewhere通知验收接收方' : 'Elsewhere通知验收发起方',
      }),
    );
    delete state.identities[i].notifications;
    await save(state);
  }
  const project = await mcp(0, (call) =>
    call('network_collaboration_project', {
      action: 'create',
      goal: '通知到自动执行验收：接收方获本机主人同意后，计算 12*3+8，在正式成果中交付一份中文 Markdown 说明，包含计算过程、结果44和验收说明。协调方创建且只创建一个任务，指定接收方为执行者、自己为审核者，检查真实成果后接受准确版本并完成项目。仅使用此测试目录，不读取或共享其他文件，不需要用户逐轮催促。',
      expected_version: 0,
      idempotency_key: randomUUID(),
    }),
  );
  state.projectId = project.project.project_id;
  await save(state);
  const invited = await mcp(0, (call) =>
    call('network_collaboration_project', {
      action: 'invite',
      project_id: state.projectId,
      agent_id: state.identities[1].agent_id,
      role: 'worker',
      scopes: ['read', 'work', 'review'],
      text: '这是您要求的真实通知链路验收。请同意后计算12*3+8，交付中文Markdown计算说明；仅在本次隔离测试目录工作。不会访问您的其他文件。',
      expected_version: project.project.version,
      idempotency_key: randomUUID(),
    }),
  );
  state.invitationVersion = invited.project.version;
  await save(state);
  console.log(
    JSON.stringify({
      projectId: state.projectId,
      sender: state.identities[0].short_id,
      recipient: state.identities[1].short_id,
      ownerApproved: false,
      automaticWorkStarted: false,
    }),
  );
} else {
  if (!state) throw Error('Prepare first');
  if (action === 'inbox') {
    const inbox = await mcp(1, (call) =>
      call('elsewhere_connection', { action: 'inbox' }),
    );
    state.notificationObservedAt = new Date().toISOString();
    state.notifiedEventIds = inbox.events
      .filter((e) => e.project_id === state.projectId)
      .map((e) => e.id);
    await save(state);
    console.log(
      JSON.stringify({
        projectId: state.projectId,
        senderShortId: state.identities[0].short_id,
        ...inbox,
      }),
    );
  } else if (action === 'bind') {
    if (!extra) throw Error('Provide actual host automation ID');
    const result = await mcp(1, (call) =>
      call('elsewhere_connection', {
        action: 'watch',
        thread_id: process.env.CODEX_THREAD_ID,
        delivery_mode: 'host_heartbeat',
        automation_id: extra,
      }),
    );
    state.automationId = extra;
    await save(state);
    console.log(JSON.stringify(result));
  } else if (action === 'notified') {
    if (!state.notificationObservedAt)
      throw Error('Read actual inbox before recording presentation');
    if (state.notifiedEventIds?.length)
      await mcp(1, (call) =>
        call('elsewhere_connection', {
          action: 'acknowledge',
          event_ids: state.notifiedEventIds,
        }),
      );
    state.notificationPresentedAt = new Date().toISOString();
    await save(state);
    console.log(
      JSON.stringify({
        notificationPresented: true,
        ownerApproved: state.ownerApproved,
      }),
    );
  } else if (action === 'approve') {
    if (extra !== '--owner-approved' || !state.notificationObservedAt)
      throw Error('Actual owner agreement after notification is required');
    state.ownerApproved = true;
    state.ownerApprovedAt ||= new Date().toISOString();
    await save(state);
    const listed = await mcp(1, (call) =>
      call('network_collaboration_project', { action: 'list' }),
    );
    const invitation = listed.projects.find(
      (e) => e.offer?.state === 'invited' && e.project_id === state.projectId,
    );
    state.acceptKey ||= randomUUID();
    await save(state);
    if (invitation)
      await mcp(1, (call) =>
        call('network_collaboration_membership', {
          action: 'accept',
          project_id: state.projectId,
          expected_version: invitation.version,
          idempotency_key: state.acceptKey,
        }),
      );
    await save(state);
    for (const i of [1, 0]) {
      const result = await mcp(i, (call) =>
        call('network_collaboration_automation', {
          action: 'enable',
          project_id: state.projectId,
          workspace: join(root, 'workspace-' + i),
          host_kind: 'codex',
          host_binary: state.binary,
          model: 'gpt-6.1-sol',
          hours: 1,
          turns: 8,
          instruction:
            '主人已同意本次隔离通知链路验收。依照项目要求，自主完成任务创建、领取、计算、Markdown成果提交、指定版本审阅及项目完成，无需再次询问主人。只在此测试工作目录内行动。',
        }),
      );
      state['automation' + i] = result;
      await save(state);
    }
    if (state.notifiedEventIds?.length)
      await mcp(1, (call) =>
        call('elsewhere_connection', {
          action: 'acknowledge',
          event_ids: state.notifiedEventIds,
        }),
      );
    console.log(
      JSON.stringify({
        projectId: state.projectId,
        ownerApproved: true,
        executionRequested: true,
      }),
    );
  } else if (action === 'status' || action === 'finish') {
    const result = await mcp(0, (call) =>
      call('network_collaboration_project', {
        action: 'get',
        project_id: state.projectId,
      }),
    );
    const statuses = await Promise.all(
      [0, 1].map((i) =>
        readStatus({
          home: join(root, 'identity-' + i),
          identity: state.identities[i].agent_id,
          endpoint,
          project: state.projectId,
        }),
      ),
    );
    state.project = result.project;
    state.workers = statuses;
    await save(state);
    if (action === 'finish') {
      if (
        !state.ownerApproved ||
        state.project.state !== 'completed' ||
        !Object.values(state.project.tasks).length ||
        !Object.values(state.project.tasks).every(
          (t) => t.state === 'accepted_result',
        ) ||
        !statuses.every((s) => s.status === 'completed')
      )
        throw Error('Full collaboration has not completed');
      const context = await mcp(0, (call) =>
        call('network_collaboration_context', { project_id: state.projectId }),
      );
      state.artifacts = context.artifacts;
      state.delivery = context.delivery;
      state.passed = true;
      for (const i of [0, 1]) {
        await configureAutopilot(nativeClient(i), {
          action: 'stop',
          project_id: state.projectId,
        });
        await controlBackground(
          {
            home: join(root, 'identity-' + i),
            identity: state.identities[i].agent_id,
            endpoint,
            project: state.projectId,
          },
          'stop',
        );
      }
      state.finishedAt = new Date().toISOString();
      await save(state);
    }
    console.log(
      JSON.stringify({
        projectId: state.projectId,
        state: state.project.state,
        ownerApproved: state.ownerApproved,
        passed: state.passed,
        tasks: Object.values(state.project.tasks).map((t) => ({
          state: t.state,
          artifactVersion: t.artifact_version,
        })),
        workers: statuses.map((s) => ({
          status: s.status,
          turns: s.turns,
          attention: s.attention,
          delivery: s.delivery,
        })),
      }),
    );
  } else throw Error('Unknown action');
}
