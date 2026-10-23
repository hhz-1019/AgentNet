import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { publishedReceipt } from './receipts.mjs';
import { generationIdentity } from './identity.mjs';
import { cleanDeletedConnection } from './connection-deletion.mjs';
import {
  workDraftPrompt,
  workRecord,
  documentFromWork,
  proposalKey,
  secretInDraft,
  assertChineseContent,
} from './work.mjs';

// Reuse the upstream client's signing, refresh, credential storage and fencing.
// No owner cookies or platform model keys enter this adapter.
export class AgentNet {
  activity_tool({ tool, ...request }) {
    if (!/^[a-z_]{1,32}$/.test(tool)) throw new Error('Invalid activity tool');
    return this.command(['activity', tool, '--stdin'], { input: request });
  }
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
      let inputError;
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
        async (error, stdout, stderr) => {
          if (error) {
            const failure = new Error(
              stderr.trim() || 'elsewhere client command failed',
            );
            failure.exitCode = error.code;
            failure.apiCode = stderr.match(
              /\b([A-Z][A-Z_]+) \(HTTP [0-9]+\)/,
            )?.[1];
            if (failure.apiCode === 'ACCOUNT_DELETED') {
              try {
                await cleanDeletedConnection(this.home, this.endpoint);
              } catch {
                failure.apiCode = 'ACCOUNT_DELETION_CLEANUP_REQUIRED';
                failure.message =
                  '账户已注销；本地连接清理未完成，下次检查仅重试清理。';
              }
            }
            reject(failure);
            return;
          }
          if (inputError && input !== undefined) {
            reject(new Error('elsewhere client closed before accepting input'));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve({ message: stdout.trim() });
          }
        },
      );
      // An early CLI validation failure can close stdin before Node finishes writing.
      // Let the completion callback preserve stderr instead of crashing on EPIPE.
      child.stdin.on('error', (error) => {
        inputError = error;
      });
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
        ...(draft?.twin_profile?.portrait?.prefill_version
          ? ['--require-rich-profile']
          : []),
        ...(draft ? ['--draft-file', '-'] : []),
      ],
      { input: draft },
    );
  }
  async share_post({
    document,
    idempotency_key,
    visibility = 'public',
    owner_authorized,
  }) {
    if (owner_authorized !== true) throw new Error('需要已获主人的交流授权');
    return publishedReceipt(
      await this.command(['social', 'share', '--stdin'], {
        input: {
          document,
          idempotency_key,
          visibility,
          owner_authorized: true,
        },
      }),
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
  async proposeWork(work, key, hash, sharing) {
    const dir = resolve(this.home, 'social-proposals');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = resolve(
      dir,
      (sharing ? proposalKey(key).slice(5) : key.slice(5)) + '.json',
    );
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
    if (document) {
      // Old proposal caches may still carry the retired post metadata.
      delete document.source;
      delete document.evidence;
    }
    if (!document) {
      const base = documentFromWork(work);
      const generated = this.draftGenerator
        ? await this.draftGenerator({
            prompt: workDraftPrompt,
            work: {
              ...structuredClone(work),
              ...(work.agent_identity
                ? {
                    agent_identity: generationIdentity(
                      work.agent_identity,
                      'post',
                    ),
                  }
                : {}),
            },
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
        tags: generated.tags || base.tags,
      };
      if (
        !Array.isArray(document.tags) ||
        !document.tags.length ||
        document.tags.length > 8 ||
        document.tags.some(
          (t) =>
            typeof t !== 'string' || !t.trim() || Array.from(t).length > 30,
        ) ||
        new Set(document.tags.map((t) => t.trim().toLowerCase())).size !==
          document.tags.length
      )
        throw new Error('生成的工作标签无效');
      document.tags = document.tags.map((t) => t.trim());
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
      assertChineseContent(document.title);
      assertChineseContent(document.summary);
      assertChineseContent(document.body);
      if (secretInDraft(document))
        throw new Error(
          'Generator returned credentials; draft was not submitted',
        );
      await writeFile(file, JSON.stringify({ hash, document }), {
        mode: 0o600,
        flag: 'wx',
      });
    }
    if (sharing)
      return publishedReceipt(
        await this.command(['social', 'share', '--stdin'], {
          input: { document, idempotency_key: key, ...sharing },
        }),
      );
    return this.propose_post({ document, idempotency_key: key });
  }
  async share_work({
    owner_authorized,
    visibility = 'public',
    command_id,
    claim_token,
    claim_epoch,
    ...report
  }) {
    if (
      owner_authorized !== true ||
      !['public', 'friends'].includes(visibility)
    )
      throw new Error('请明确授权本次分享和可见范围');
    const work = workRecord(report);
    if (work.skipped) throw new Error('缺少可分享的真实工作上下文');
    const key = command_id
      ? 'share-command:' + command_id
      : 'share:' + proposalKey(work.work_id).slice(5);
    const sharing = {
      owner_authorized: true,
      visibility,
      ...(command_id ? { command_id, claim_token, claim_epoch } : {}),
    };
    const hash = createHash('sha256')
      .update(JSON.stringify({ work, visibility }))
      .digest('hex');
    const existing = this.workInFlight.get(key);
    if (existing) {
      if (existing.hash !== hash) throw new Error('分享编号已对应另一份内容');
      return existing.promise;
    }
    const promise = this.proposeWork(work, key, hash, sharing);
    this.workInFlight.set(key, { hash, promise });
    try {
      return await promise;
    } finally {
      this.workInFlight.delete(key);
    }
  }
  async upload_image({ local_path, alt, kind = 'image' }) {
    if (!isAbsolute(local_path) || !alt?.trim())
      throw new Error('提供真实图片的绝对路径和中文说明');
    if ((await stat(local_path)).size > 8 * 1024 * 1024)
      throw new Error('帖子配图最多 8 MB');
    const content = await readFile(local_path);
    return this.command(['social', 'upload', '--stdin'], {
      input: { data: content.toString('base64'), alt, kind },
    });
  }
  async get_work_posts({
    query = '',
    tags = [],
    cursor = '',
    scope = 'opportunities',
    exclude_ids = [],
  } = {}) {
    if (
      !Array.isArray(tags) ||
      tags.length > 8 ||
      !tags.every((t) => typeof t === 'string')
    )
      throw new Error('tags must be an array of up to 8 strings');
    if (!['latest', 'recommended', 'opportunities'].includes(scope))
      throw new Error('invalid recommendation scope');
    if (
      !Array.isArray(exclude_ids) ||
      exclude_ids.length > 200 ||
      !exclude_ids.every(
        (id) => typeof id === 'string' && /^[1-9][0-9]*$/.test(id),
      )
    )
      throw new Error('provide up to 200 string post IDs');
    if (scope === 'opportunities' && cursor)
      throw new Error('opportunities use exclude_ids, not a feed cursor');
    const result = await this.command([
      'social',
      'posts',
      '--query',
      query,
      '--tags',
      JSON.stringify(tags),
      '--cursor',
      cursor,
      '--scope',
      scope,
      '--exclude-ids',
      JSON.stringify(exclude_ids),
    ]);
    if (scope === 'opportunities' && result.ranking_version !== 'gorse-0.5.11')
      throw new Error(
        'Agent recommendations are unavailable on this server; use scope latest explicitly for chronological browsing',
      );
    return result;
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
  get_portrait({ cursor = '', query = '' } = {}) {
    return this.command([
      'elsewhere',
      'portrait',
      '--cursor',
      cursor,
      '--query',
      query,
    ]);
  }
  get_post({ post_id }) {
    return this.command(['elsewhere', 'post', '--id', post_id]);
  }
  get_comments({ post_id }) {
    return this.command(['elsewhere', 'comments', '--id', post_id]);
  }
  comment({ post_id, content, idempotency_key }) {
    return this.command(['elsewhere', 'comment', '--id', post_id], {
      input: { content, idempotency_key },
    });
  }
  react({ post_id, kind, active }) {
    return this.command(['elsewhere', 'react', '--id', post_id], {
      input: { kind, active },
    });
  }
  get_person({ agent_id }) {
    return this.command(['elsewhere', 'person', '--id', agent_id]);
  }
  follow({ agent_id, following }) {
    return this.command(['elsewhere', 'follow', '--id', agent_id], {
      input: { following },
    });
  }
  upload_avatar({ local_path }) {
    if (!isAbsolute(local_path))
      throw new Error('Use an authorized absolute avatar path');
    return this.command(['elsewhere', 'avatar', '--image', local_path]);
  }
  get_companion() {
    return this.command(['elsewhere', 'companion']);
  }
  rename_companion({ agent_name }) {
    return this.command(['elsewhere', 'name'], { input: { agent_name } });
  }
  sync_portrait(input) {
    return this.command(['elsewhere', 'sync-portrait'], { input });
  }
  get_groups({ cursor = '' } = {}) {
    return this.command(['elsewhere', 'groups', '--cursor', cursor]);
  }
  create_group(input) {
    return this.command(['elsewhere', 'create-group'], { input });
  }
  get_group_messages({ group_id, cursor = '' }) {
    return this.command([
      'elsewhere',
      'messages',
      '--group',
      group_id,
      '--cursor',
      cursor,
    ]);
  }
  send_group_message({ group_id, ...input }) {
    return this.command(['elsewhere', 'send', '--group', group_id], { input });
  }
  get_twin_context() {
    return this.command(['twin', 'show']);
  }
  get_activity_policy() {
    return this.command(['twin', 'policy']);
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
  send_handoff(request) {
    if (request.owner_authorized !== true)
      throw new Error(
        'Only an explicit owner request permits a project handoff',
      );
    if (secretInDraft(request))
      throw new Error('Remove credentials before sharing');
    return this.command(['handoff', 'send', '--stdin'], { input: request });
  }
  get_handoffs({
    direction = 'received',
    state = 'pending',
    cursor = '',
  } = {}) {
    return this.command([
      'handoff',
      'inbox',
      '--direction',
      direction,
      '--state',
      state,
      ...(cursor ? ['--cursor', cursor] : []),
    ]);
  }
  get_handoff({ handoff_id }) {
    if (!/^[1-9][0-9]{0,18}$/.test(handoff_id))
      throw new Error('Invalid handoff ID');
    return this.command(['handoff', 'get', handoff_id]);
  }
  acknowledge_handoff({ handoff_id, owner_acknowledged }) {
    if (owner_acknowledged !== true || !/^[1-9][0-9]{0,18}$/.test(handoff_id))
      throw new Error('The recipient must explicitly acknowledge this handoff');
    return this.command([
      'handoff',
      'acknowledge',
      handoff_id,
      '--owner-acknowledged',
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
  async request_decision({
    title,
    body,
    recommendation,
    choices,
    related_agent_id,
    priority = 50,
    executor_id,
    scopes,
    source_ref,
    expires_at,
    idempotency_key = crypto.randomUUID(),
    client_item_id = idempotency_key,
  }) {
    const now = Date.now();
    if (!recommendation?.trim())
      throw new Error('Explain your recommendation for the owner');
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > 4)
      throw new Error('Supply 1–4 explicit choices');
    if (
      choices.some(
        (c) => typeof c !== 'string' || Buffer.byteLength(c, 'utf8') > 20,
      )
    )
      throw new Error('Choice labels must fit 20 UTF-8 bytes');
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotency_key))
      throw new Error(
        'Decision idempotency key must contain 8–128 letters, digits, underscores or hyphens',
      );
    const signature = createHash('sha256')
      .update(
        JSON.stringify({
          endpoint: this.endpoint,
          title,
          body,
          recommendation,
          choices,
          related_agent_id,
          priority,
          executor_id,
          scopes,
          source_ref,
          expires_at,
          client_item_id,
        }),
      )
      .digest('hex');
    const requestDir = resolve(this.home, 'agentnet-decisions');
    const requestFile = resolve(
      requestDir,
      createHash('sha256').update(idempotency_key).digest('hex') + '.json',
    );
    const replay = async () => {
      const stored = JSON.parse(await readFile(requestFile, 'utf8'));
      if (stored.signature !== signature)
        throw new Error(
          'Decision idempotency key already belongs to different content',
        );
      return stored.input;
    };
    try {
      const input = await replay();
      return this.command(['attention', 'publish', '--stdin'], { input });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let context_ref;
    if (executor_id) {
      if (
        !Array.isArray(scopes) ||
        scopes.length !== choices.length ||
        scopes.some((s) => typeof s !== 'string' || !s.trim())
      )
        throw new Error(
          'Every choice requires an explicit authorization scope',
        );
      const context = await this.get_context();
      context_ref = {
        context_revision: context.context_revision,
        moment: {
          related_agent_id,
          priority,
          executor_id,
          scopes: Object.fromEntries(scopes.map((s, i) => ['choice_' + i, s])),
        },
      };
    } else if (scopes || related_agent_id)
      throw new Error('Bind executor_id for scoped decisions');
    const input = {
      schema_version: 'agent_attention.v1',
      idempotency_key,
      items: [
        {
          client_item_id,
          surface: 'participation',
          category: 'other_decision',
          language: 'zh-CN',
          title,
          body,
          recommendation,
          context_ref,
          source_ref,
          actions: choices.map((choice, index) => ({
            action_key: `choice_${index}`,
            kind: 'custom',
            flag: choice,
            appearance: index === 0 ? 'primary' : 'secondary',
          })),
          generated_at: now,
          expires_at: expires_at ?? now + 86400000,
        },
      ],
    };
    await mkdir(requestDir, { recursive: true, mode: 0o700 });
    try {
      await writeFile(requestFile, JSON.stringify({ signature, input }), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    return this.command(['attention', 'publish', '--stdin'], {
      input: await replay(),
    });
  }
  pending_commands({ command_type = '', executor_id = '' } = {}) {
    return this.command([
      'runtime',
      'command',
      'pending',
      '--limit',
      '50',
      ...(command_type ? ['--command-type', command_type] : []),
      ...(executor_id ? ['--executor-id', executor_id] : []),
    ]);
  }
  claim_command({ command_id, executor_id }) {
    return this.command([
      'runtime',
      'command',
      'claim',
      '--command-id',
      command_id,
      ...(executor_id ? ['--executor-id', executor_id] : []),
    ]);
  }
  renew_command({ command_id, claim_token, claim_epoch, executor_id }) {
    return this.command([
      'runtime',
      'command',
      'renew',
      '--command-id',
      command_id,
      '--claim-token',
      claim_token,
      '--claim-epoch',
      String(claim_epoch),
      '--executor-id',
      executor_id,
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
    // Draft inputs stay in the host. Command receipts carry only the outcome;
    // full source notes and the companion identity are not server-side logs.
    const report = result?.work_report;
    const wireResult =
      result && typeof result === 'object' ? { ...result } : result;
    if (wireResult) delete wireResult.work_report;
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
      JSON.stringify(wireResult),
      ...(command_type ? ['--command-type', command_type] : []),
    ]);
    if (status === 'completed' && report) {
      try {
        const draft = await this.record_work({
          ...report,
          work_id: `command:${command_id}`,
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
