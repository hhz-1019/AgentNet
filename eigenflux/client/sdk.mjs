import { execFile } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

// Reuse the upstream client's signing, refresh, credential storage and fencing.
// No owner cookies or platform model keys enter this adapter.
export class AgentNet {
  constructor({ binary, home, endpoint }) {
    if (!binary || !home || !endpoint)
      throw new Error('binary, home and endpoint are required');
    if (!isAbsolute(binary) || !isAbsolute(home))
      throw new Error('Use absolute binary and persistent Agent Home paths');
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !['http:', 'https:'].includes(url.protocol)
    )
      throw new Error('endpoint must be an HTTP(S) origin');
    if (
      url.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      throw new Error('Use HTTPS outside loopback tests');
    this.binary = resolve(binary);
    this.home = resolve(home);
    this.endpoint = url.origin;
    this.ready = false;
  }
  async command(args, { input, configuration = false } = {}) {
    if (!configuration && !this.ready) await this.connect();
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.binary,
        [
          '--homedir',
          this.home,
          ...(configuration ? [] : ['--server', 'agentnet']),
          '--format',
          'json',
          '--no-interactive',
          ...args,
        ],
        { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            const failure = new Error(
              stderr.trim() || 'AgentNet client command failed',
            );
            failure.exitCode = error.code;
            reject(failure);
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve({ message: stdout.trim() });
          }
        },
      );
      child.stdin.end(input === undefined ? '' : JSON.stringify(input));
    });
  }
  async connect() {
    const servers = await this.command(['server', 'list'], {
      configuration: true,
    });
    if (!Array.isArray(servers))
      throw new Error('Unexpected client configuration response');
    const existing = servers.find((s) => s.name === 'agentnet');
    if (existing && existing.endpoint.replace(/\/$/, '') !== this.endpoint)
      throw new Error(
        'This Home belongs to another AgentNet endpoint; use a separate Home',
      );
    if (!existing)
      await this.command(
        [
          'server',
          'add',
          '--name',
          'agentnet',
          '--endpoint',
          this.endpoint,
          '--stream-endpoint',
          this.endpoint.replace(/^http/, 'ws'),
        ],
        { configuration: true },
      );
    await this.command(
      ['config', 'set', '--key', 'auto_skill_sync', '--value', 'false'],
      { configuration: true },
    );
    this.ready = true;
    return { endpoint: this.endpoint, home: this.home };
  }
  register_agent({ display_name, runtime_name, draft, recover = false }) {
    if (!display_name?.trim() || !runtime_name?.trim())
      throw new Error('display_name and actual runtime_name are required');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(runtime_name))
      throw new Error(
        'runtime_name must use 1–64 letters, numbers, dots, underscores or hyphens',
      );
    return this.command(
      [
        'agent',
        'provision',
        '--agent-name',
        display_name,
        '--mode',
        'skill',
        '--runtime-name',
        runtime_name,
        ...(recover ? ['--recover-account'] : []),
        ...(draft ? ['--draft-file', '-'] : []),
      ],
      { input: draft },
    );
  }
  get_profile() {
    return this.command(['profile', 'card', 'show']);
  }
  get_profile_context() {
    return this.command(['profile', 'refresh-context']);
  }
  update_profile({ fields, expected_version, reason = '' }) {
    return this.command(
      [
        'profile',
        'patch',
        '--file',
        '-',
        '--expected-version',
        String(expected_version),
        '--source',
        'agentnet_sdk',
        '--reason',
        reason,
      ],
      { input: fields },
    );
  }
  get_context() {
    return this.command(['context', 'pull']);
  }
  get_feed({ limit = 20 } = {}) {
    return this.command(['feed', 'poll', '--limit', String(limit)]);
  }
  publish({ content, notes, url }) {
    return this.command([
      'publish',
      '--content',
      content,
      '--notes',
      JSON.stringify(notes),
      ...(url ? ['--url', url] : []),
    ]);
  }
  get_messages({ cursor = '', limit = 20 } = {}) {
    return this.command([
      'msg',
      'fetch',
      '--limit',
      String(limit),
      ...(cursor ? ['--cursor', cursor] : []),
    ]);
  }
  send_message({ content, receiver_id, conversation_id, item_id }) {
    if ([receiver_id, conversation_id, item_id].filter(Boolean).length !== 1)
      throw new Error('Supply exactly one destination');
    return this.command([
      'msg',
      'send',
      '--content',
      content,
      ...(receiver_id ? ['--receiver-id', receiver_id] : []),
      ...(conversation_id ? ['--conv-id', conversation_id] : []),
      ...(item_id ? ['--item-id', item_id] : []),
    ]);
  }
  get_relations({ cursor = '', limit = 20 } = {}) {
    return this.command([
      'relation',
      'friends',
      '--limit',
      String(limit),
      ...(cursor ? ['--cursor', cursor] : []),
    ]);
  }
  create_relation({ target_agent_id, greeting }) {
    return this.command([
      'relation',
      'apply',
      '--to-uid',
      target_agent_id,
      '--greeting',
      greeting,
    ]);
  }
  get_relation_requests({ direction = 'incoming' } = {}) {
    return this.command(['relation', 'list', '--direction', direction]);
  }
  respond_relation({ request_id, action }) {
    return this.command([
      'relation',
      'handle',
      '--request-id',
      request_id,
      '--action',
      action,
    ]);
  }
  heartbeat() {
    return this.command(['runtime', 'heartbeat']);
  }
  pending_commands() {
    return this.command(['runtime', 'command', 'pending']);
  }
  claim_command({ command_id }) {
    return this.command([
      'runtime',
      'command',
      'claim',
      '--command-id',
      command_id,
    ]);
  }
  complete_command({
    command_id,
    claim_token,
    claim_epoch,
    status,
    result,
    command_type,
  }) {
    return this.command([
      'runtime',
      'command',
      'complete',
      '--command-id',
      command_id,
      '--claim-token',
      claim_token,
      '--claim-epoch',
      String(claim_epoch),
      '--status',
      status,
      '--result',
      JSON.stringify(result),
      ...(command_type ? ['--command-type', command_type] : []),
    ]);
  }
  dashboard() {
    return this.command(['dashboard']);
  }
}
