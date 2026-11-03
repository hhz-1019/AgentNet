import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const hostCapabilities = Object.freeze({
  owner_notifications: {
    entry_tool: 'elsewhere_connection',
    notification_authorization_separate_from_execution: true,
    native_queue_adapter: 'codex',
    direct_wakeup_requires_reachable_host_daemon: true,
    fallback: 'same_chat_native_heartbeat',
    queue_success_is_not_delivery: true,
    generic_mcp_does_not_imply_chat_wakeup: true,
  },
  continuous_collaboration: {
    supported: true,
    entry_tool: 'network_collaboration_automation',
    adapters: ['codex', 'claude_code', 'opencode'],
    verified_adapters: ['codex', 'opencode'],
    host_binding: 'installed_host_no_fallback',
    adapter_requirements: {
      codex: 'Installed Codex with working model access',
      claude_code:
        'Installed Claude Code with working model access; Windows requires Git Bash',
      opencode:
        'Windows OpenCode V2 ACP with explicitly configured loopback model',
      generic: 'Foreground MCP only; no native background adapter',
    },
    verified_platforms: ['win32'],
    one_time_local_owner_scope: true,
    trusted_invitation_watch: true,
    automatic_planning_and_revision: true,
    same_native_session_resume: true,
    arbitrary_gui_injection: false,
    requires_computer_awake: true,
    operating_system_startup_service: false,
  },
  local_companion: {
    supported: true,
    verified: true,
    verification_scope: {
      platform: 'win32',
      backend: 'local_core_fixture',
      adapters: ['codex', 'opencode'],
      date: '2026-11-03',
      plugin_version: '0.0.54-agentnet.37',
    },
    owner_policy_required: true,
    minimum_cli_version: '0.0.54-agentnet.29',
    exact_session_resume: true,
    arbitrary_gui_injection: false,
    codex_usd_budget: false,
    windows_os_sandbox: false,
  },
  execution_mode: 'host_session_only',
  grant_basis: 'authenticated_agent_delegation',
  current_session: { supported: true, verified: true },
  external_wake: { supported: false, verified: false },
  resume: { supported: false, verified: false },
  injection: { supported: false, verified: false },
  background_execution: { supported: false, verified: false },
  remote_stop_ack: { supported: false, verified: false },
  adapters: {
    codex: {
      supported: true,
      verified: true,
      verified_platforms: ['win32'],
      verified_native_version: '0.166.0',
      verification_plugin_version: '0.0.54-agentnet.29',
      verification_date: '2026-11-02',
      verified_model: 'gpt-6.1-sol',
    },
    claude_code: { supported: true, verified: false },
    opencode: {
      supported: true,
      verified: true,
      historical_verified: true,
      verified_platforms: ['win32'],
      verified_model: 'elsewhere-local/qwen2.5:7b-elsewhere-tools',
      verification_plugin_version: '0.0.54-agentnet.37',
      latest_pilot: {
        date: '2026-11-03',
        plugin_version: '0.0.54-agentnet.37',
        passed: true,
        project: '87c7eb0132a17841af38043affe831ac',
        scope:
          'Windows local Core fixture; automatic planning, revision, review and delivery',
      },
      platforms: ['win32'],
      native_version: '2.2.5',
      local_models_only: true,
    },
  },
});
export class CollaborationHost {
  constructor({ home, endpoint, identity, project, readUpdates }) {
    if (!home || !identity || !project || typeof readUpdates !== 'function')
      throw new Error(
        'Explicit home, identity, project and readUpdates required',
      );
    const origin = new URL(endpoint);
    if (origin.origin !== endpoint.replace(/\/$/, ''))
      throw new Error('Endpoint must be an origin');
    this.binding = { endpoint: origin.origin, identity, project };
    this.readUpdates = readUpdates;
    this.directory = join(home, 'collaboration-checkpoints');
    this.file = join(
      this.directory,
      createHash('sha256').update(JSON.stringify(this.binding)).digest('hex') +
        '.json',
    );
    this.delivered = new Set();
    this.queue = Promise.resolve();
  }
  capabilities() {
    return hostCapabilities;
  }
  externalWake() {
    throw new Error('UNSUPPORTED: external wake');
  }
  resume() {
    throw new Error('UNSUPPORTED: external session resume');
  }
  inject() {
    throw new Error('UNSUPPORTED: cross-session injection');
  }
  background() {
    throw new Error('UNSUPPORTED: background execution');
  }
  async cursor() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        JSON.stringify(saved.binding) !== JSON.stringify(this.binding) ||
        !Number.isSafeInteger(saved.cursor) ||
        saved.cursor < 0
      )
        throw new Error('Invalid checkpoint');
      return saved.cursor;
    } catch (e) {
      if (e.code === 'ENOENT') return 0;
      throw e;
    }
  }
  async poll() {
    const cursor = await this.cursor();
    const result = await this.readUpdates({
      action: 'read',
      project_id: this.binding.project,
      cursor,
    });
    if (!Array.isArray(result.events)) throw new Error('Invalid events');
    let last = cursor;
    for (const event of result.events) {
      if (!Number.isSafeInteger(event.sequence) || event.sequence <= last)
        throw new Error('Invalid event order');
      last = event.sequence;
    }
    for (const event of result.events) this.delivered.add(event.sequence);
    return result;
  }
  acknowledge(sequence) {
    const operation = this.queue.then(async () => {
      const cursor = await this.cursor();
      if (
        !Number.isSafeInteger(sequence) ||
        sequence <= cursor ||
        !this.delivered.has(sequence)
      )
        throw new Error('Acknowledge only delivered events');
      for (let i = cursor + 1; i <= sequence; i++)
        if (!this.delivered.has(i))
          throw new Error('Cannot acknowledge undelivered range');
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = this.file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(
          temporary,
          JSON.stringify({ binding: this.binding, cursor: sequence }),
          { mode: 0o600, flag: 'wx' },
        );
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true });
      }
      for (const seq of this.delivered)
        if (seq <= sequence) this.delivered.delete(seq);
      return { cursor: sequence };
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
