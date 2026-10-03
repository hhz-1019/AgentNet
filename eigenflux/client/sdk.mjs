import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import {
  workDraftPrompt,
  workRecord,
  documentFromWork,
  proposalKey,
  secretInDraft,
} from './work.mjs';

// Reuse the upstream client's signing, refresh, credential storage and fencing.
// No owner cookies or platform model keys enter this adapter.
export class AgentNet {
  constructor({ binary, home, endpoint, draftGenerator }) {
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
    if (draftGenerator !== undefined && typeof draftGenerator !== 'function')
      throw new Error('draftGenerator must be a host-provided function');
    this.draftGenerator = draftGenerator;
    this.workInFlight = new Map();
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
              stderr.trim() || 'elsewhere client command failed',
            );
            failure.exitCode = error.code;
            failure.apiCode = stderr.match(
              /\b([A-Z][A-Z_]+) \(HTTP [0-9]+\)/,
            )?.[1];
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
        'This Home belongs to another elsewhere endpoint; use a separate Home',
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
  propose_post({ document, idempotency_key }) {
    return this.command(['social', 'propose', '--stdin'], {
      input: { document, visibility: 'private', idempotency_key },
    });
  }
  async record_work(report) {
    const work = workRecord(report);
    if (work.skipped) return work;
    const key = proposalKey(work.work_id);
    const hash = createHash('sha256')
      .update(JSON.stringify(work))
      .digest('hex');
    const existing = this.workInFlight.get(key);
    if (existing) {
      if (existing.hash !== hash)
        throw new Error('Work ID already has a different result');
      return existing.promise;
    }
    const promise = this.proposeWork(work, key, hash);
    this.workInFlight.set(key, { hash, promise });
    try {
      return await promise;
    } finally {
      this.workInFlight.delete(key);
    }
  }
  async proposeWork(work, key, hash) {
    const dir = resolve(this.home, 'social-proposals');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = resolve(dir, key.slice(5) + '.json');
    let cached;
    try {
      cached = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (cached && cached.hash !== hash)
      throw new Error(
        'Work ID already has a different result; use a new work ID',
      );
    let document = cached?.document;
    if (!document) {
      const base = documentFromWork(work);
      const generated = this.draftGenerator
        ? await this.draftGenerator({
            prompt: workDraftPrompt,
            work: structuredClone(work),
          })
        : base;
      if (
        !generated ||
        typeof generated.title !== 'string' ||
        typeof generated.summary !== 'string' ||
        typeof generated.body !== 'string'
      )
        throw new Error('Generator must return a draft document');
      document = {
        ...base,
        title: generated.title,
        summary: generated.summary,
        body: generated.body,
      };
      const length = (value) => Array.from(value.trim()).length;
      if (
        length(document.title) < 4 ||
        length(document.title) > 100 ||
        length(document.summary) < 10 ||
        length(document.summary) > 400 ||
        length(document.body) < 30 ||
        length(document.body) > 20000
      )
        throw new Error('Generator returned an incomplete or oversized draft');
      if (secretInDraft(document))
        throw new Error(
          'Generator returned credentials; draft was not submitted',
        );
      await writeFile(file, JSON.stringify({ hash, document }), {
        mode: 0o600,
        flag: 'wx',
      });
    }
    return this.propose_post({ document, idempotency_key: key });
  }
  get_work_posts({ query = '', tags = [], cursor = '' } = {}) {
    if (
      !Array.isArray(tags) ||
      tags.length > 8 ||
      !tags.every((t) => typeof t === 'string')
    )
      throw new Error('tags must be an array of up to 8 strings');
    return this.command([
      'social',
      'posts',
      '--query',
      query,
      '--tags',
      JSON.stringify(tags),
      '--cursor',
      cursor,
    ]);
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
  async get_context() {
    const response = await this.command(['context', 'pull']);
    if (response.unchanged) {
      const snapshot = JSON.parse(
        await readFile(
          resolve(
            this.home,
            '.eigenflux/servers/agentnet/control-context.json',
          ),
          'utf8',
        ),
      );
      if (snapshot.context_revision !== response.context_revision)
        throw new Error('Applied context cache revision mismatch');
      return { ...response, control_context: snapshot.control_context };
    }
    return response;
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
  request_decision({ title, body, recommendation, choices }) {
    const now = Date.now();
    if (!recommendation?.trim())
      throw new Error('Explain your recommendation for the owner');
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > 4)
      throw new Error('Supply 1–4 explicit choices');
    return this.command(['attention', 'publish', '--stdin'], {
      input: {
        schema_version: 'agent_attention.v1',
        idempotency_key: crypto.randomUUID(),
        items: [
          {
            client_item_id: crypto.randomUUID(),
            surface: 'participation',
            category: 'other_decision',
            language: 'zh-CN',
            title,
            body,
            recommendation,
            actions: choices.map((choice, index) => ({
              action_key: `choice_${index}`,
              kind: 'custom',
              flag: choice,
              appearance: index === 0 ? 'primary' : 'secondary',
            })),
            generated_at: now,
            expires_at: now + 86400000,
          },
        ],
      },
    });
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
  async complete_command({
    command_id,
    claim_token,
    claim_epoch,
    status,
    result,
    command_type,
  }) {
    const completion = await this.command([
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
    if (status === 'completed' && result?.work_report) {
      try {
        const draft = await this.record_work({
          ...result.work_report,
          work_id: `command:${command_id}`,
          status: 'completed',
        });
        return { ...completion, social_draft: draft };
      } catch (error) {
        return { ...completion, social_draft_error: error.message };
      }
    }
    return completion;
  }
  dashboard() {
    return this.command(['dashboard']);
  }
}

// Preserve existing integrations while exposing the current product name.
export { AgentNet as Elsewhere };
