// Acceptance harness: synthetic owners explicitly authorize only this local fixture.
import { spawn, execFile } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pluginModelTurn } from './collaboration-plugin-model-turn.mjs';
import { installFixturePlugin } from './collaboration-installed-plugin.mjs';
const toml = (value) =>
  typeof value === 'object' && !Array.isArray(value)
    ? '{' +
      Object.entries(value)
        .map(([k, v]) => JSON.stringify(k) + '=' + toml(v))
        .join(',') +
      '}'
    : Array.isArray(value)
      ? '[' + value.map(toml).join(',') + ']'
      : JSON.stringify(value);
export async function nativeInvite({ fixture, workspace }) {
  const receipts = [];
  async function turn(identity, prompt) {
    const installed = process.env.AGENTNET_LIVE_PLUGIN_MARKETPLACE
      ? await installFixturePlugin({ fixture, workspace, identity })
      : null;
    if (installed) {
      const receipt = {
        identity,
        tools: [],
        completed: false,
        plugin: installed.receipt,
      };
      const code = await pluginModelTurn({ installed, prompt, receipt });
      await writeFile(
        resolve(workspace, `native-invitation-${identity}.json`),
        JSON.stringify(receipt, null, 2),
      );
      assert.equal(code, 0);
      assert.ok(
        receipt.tools.some(
          (t) => t.tool === 'elsewhere_connection' && t.status === 'completed',
        ),
        'Native model did not use plugin connection',
      );
      receipts.push(receipt);
      return;
    }
    const names = ['project', 'membership', 'context'].map(
      (g) => 'network_collaboration_' + g,
    );
    const config = {
      command: process.execPath,
      args: [resolve('elsewhere/client/collaboration-mcp.mjs')],
      env: {
        AGENTNET_CLI: resolve(process.env.AGENTNET_LIVE_CLI),
        AGENTNET_HOME: fixture.homes[identity],
        AGENTNET_URL: fixture.endpoint,
      },
      default_tools_approval_mode: 'prompt',
      enabled_tools: names,
      tools: Object.fromEntries(
        names.map((n) => [n, { approval_mode: 'approve' }]),
      ),
    };
    const hostBinary = resolve(process.env.AGENTNET_LIVE_CODEX);
    const args = [
      ...(hostBinary.endsWith('.js') ? [hostBinary] : []),
      'exec',
      '--ignore-user-config',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--json',
      '--model',
      process.env.AGENTNET_LIVE_CODEX_MODEL || 'gpt-6.1-sol',
      '-C',
      workspace,
    ];
    for (const override of [
      'approval_policy="never"',
      'features.shell_tool=false',
      'features.apps=false',
      'features.multi_agent=false',
      'features.apply_patch_freeform=false',
      'features.view_image=false',
      'features.hooks=false',
      'web_search="disabled"',
      'mcp_servers.elsewhere=' + toml(config),
    ])
      args.push('-c', override);
    args.push('-');
    const child = spawn(
      hostBinary.endsWith('.js') ? process.execPath : hostBinary,
      args,
      {
        cwd: workspace,
        env: process.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let buffer = '',
      failed = false,
      ended = false;
    const receipt = {
      identity,
      tools: [],
      completed: false,
    };
    const stop = () => {
      if (ended || !child.pid) return;
      if (process.platform === 'win32')
        execFile(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          () => {},
        );
      else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    };
    const timer = setTimeout(stop, 300000);
    child.stderr.resume();
    child.stdout.on('data', (part) => {
      buffer += part;
      let line;
      while ((line = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, line);
        buffer = buffer.slice(line + 1);
        try {
          const e = JSON.parse(raw);
          if (e.type === 'thread.started') receipt.sessionId = e.thread_id;
          if (e.type === 'turn.completed') receipt.completed = true;
          if (e.type === 'item.completed' && e.item?.type === 'agent_message')
            receipt.finalMessage = e.item.text?.slice(0, 4000);
          if (e.type === 'turn.failed') {
            failed = true;
            receipt.failureType = e.type;
          }
          // CLI also emits `error` for a recoverable streaming reconnect. A final
          // turn.completed plus successful tool receipts determines completion.
          if (e.type === 'error')
            receipt.transportNotices = (receipt.transportNotices || 0) + 1;
          if (e.type === 'item.completed' && e.item?.type === 'mcp_tool_call') {
            receipt.tools.push({
              tool: e.item.tool,
              action: e.item.arguments?.action,
              status: e.item.status,
            });
            console.log(
              JSON.stringify({
                nativeInvitation: identity,
                tool: e.item.tool,
                action: e.item.arguments?.action,
                status: e.item.status,
              }),
            );
          }
        } catch {
          failed = true;
        }
      }
      if (buffer.length > 2 * 1024 * 1024) {
        failed = true;
        stop();
      }
    });
    child.stdin.end(prompt);
    const code = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', done);
    }).finally(() => {
      ended = true;
      clearTimeout(timer);
    });
    await writeFile(
      resolve(workspace, `native-invitation-${identity}.json`),
      JSON.stringify(receipt, null, 2),
    );
    assert.equal(code, 0, 'Native invitation process failed');
    assert.equal(failed, false);
    assert.ok(receipt.completed);
    receipts.push(receipt);
  }
  await turn(
    '1',
    '你是本地测试主人 A 的 Agent。我授权你通过 Elsewhere 和 @PeerB 协作，做一个可离线使用的中文订单计算器。请现在用 MCP 按公开短号找到他，创建一个项目并邀请他做计算核验和成果审核，权限只需 read/work/review。邀请说明写清工作内容，不共享私有记忆。只完成创建和邀请，不创建任务，不代替对方接受。你有本次共享合成项目的主人授权。实际调用工具，不要只描述计划。每次写入使用最新 project.version 和唯一 idempotency_key；创建 expected_version=0。',
  );
  const list = await fixture.clients['1'].collaboration_project({
    action: 'list',
  });
  assert.equal(list.projects.length, 1);
  const initial = list.projects[0];
  assert.equal(initial.members['2'].state, 'invited');
  assert.ok(initial.members['2'].invitation);
  assert.ok(receipts[0].tools.some((t) => t.action === 'resolve'));
  assert.ok(receipts[0].tools.some((t) => t.action === 'invite'));
  await turn(
    '2',
    '你是本地测试主人 B 的 Agent。我授权你查看 Elsewhere 项目邀请，并接受来自测试同伴的离线订单计算器协作邀请，允许共享该项目的合成数据与成果。请实际调用 project list 找到邀请，读取邀请说明，再调用 membership accept 接受。不创建新项目或任务，不提交或审核成果。使用邀请返回的最新 project version 和唯一 idempotency_key。此次是当前本地主人的明确授权，不是远程消息授权。',
  );
  assert.ok(receipts[1].tools.some((t) => t.action === 'accept'));
  const { project } = await fixture.clients['1'].collaboration_project({
    action: 'get',
    project_id: initial.project_id,
  });
  assert.equal(project.members['2'].state, 'active');
  return { project, receipts };
}
