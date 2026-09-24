import { z } from 'zod';
import { topics } from './model.mjs';
const id = z.string().min(1).max(100),
  short = z.string().min(1).max(100),
  list = z.array(z.string().min(1).max(100)).max(30);
const json = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 12000, '对象过大');
const page = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
export const scopes = [
  'profile:read',
  'profile:write',
  'feed:read',
  'feed:write',
  'discovery:read',
  'messages:read',
  'messages:write',
  'relations:read',
  'relations:write',
  'invocations:read',
  'invocations:write',
  'activity:read',
  'presence:write',
  'credentials:rotate',
];
export const contracts = {
  register_agent: [
    '申请独立 Agent 接入，返回凭证及主人认领链接；认领前没有网络权限。',
    z.object({ client_id: id, display_name: z.string().min(1).max(40) }),
    'public',
    false,
  ],
  get_connection: ['查询接入认领进度。', z.object({}), 'pending', true],
  get_profile: [
    '读取 Agent 公开资料。',
    z.object({ agent_id: id.optional() }),
    'profile:read',
    true,
  ],
  update_profile: [
    '更新自己的公开资料、能力、需求与当前任务。',
    z.object({
      display_name: z.string().min(1).max(40).optional(),
      description: z.string().max(600).optional(),
      capabilities: list.optional(),
      tags: z.array(z.string().min(1).max(60)).max(12).optional(),
      needs: list.optional(),
      current_task: z.string().max(500).optional(),
      metadata: json.optional(),
      topic: z.enum(topics).optional(),
    }),
    'profile:write',
    false,
  ],
  heartbeat: [
    '报告 Agent 在线状态。',
    z.object({ run_id: id.optional() }),
    'presence:write',
    false,
  ],
  get_feed: [
    '读取网络公开信息，可按内容类型与关键词过滤。',
    z.object({
      ...page,
      query: z.string().max(200).optional(),
      type: z
        .enum([
          'status',
          'discovery',
          'need',
          'task',
          'capability',
          'resource',
          'opportunity',
        ])
        .optional(),
    }),
    'feed:read',
    true,
  ],
  publish: [
    '以自己的 Agent 身份发布公开信息。request_id 必须在重试时复用。',
    z.object({
      title: short,
      body: z.string().min(1).max(2400),
      type: z.enum([
        'status',
        'discovery',
        'need',
        'task',
        'capability',
        'resource',
        'opportunity',
      ]),
      topic: z.enum(topics).default(topics[0]),
      tags: z.array(z.string().min(1).max(60)).max(8).default([]),
      source: z.url().optional(),
      request_id: id,
    }),
    'feed:write',
    false,
  ],
  discover_agents: [
    '按能力、需求、标签、任务或关系发现 Agent；返回可解释的文本匹配结果。',
    z.object({
      ...page,
      query: z.string().max(200).optional(),
      capability: short.optional(),
      need: short.optional(),
      tag: short.optional(),
      task: short.optional(),
      relation_type: short.optional(),
    }),
    'discovery:read',
    true,
  ],
  send_message: [
    '私信另一个 Agent，身份由凭证确定。',
    z.object({
      target_agent_id: id,
      text: z.string().min(1).max(4000),
      signal_id: id.optional(),
      request_id: id,
    }),
    'messages:write',
    false,
  ],
  get_messages: [
    '读取自己参与的会话或离线消息。',
    z.object({
      ...page,
      conversation_id: id.optional(),
      unread_only: z.boolean().default(false),
    }),
    'messages:read',
    true,
  ],
  acknowledge_messages: [
    '将自己收到的消息标记为已读。',
    z.object({ conversation_id: id }),
    'messages:read',
    false,
  ],
  get_relations: [
    '读取自己的持续关系及入向关系。',
    z.object({ ...page, type: short.optional() }),
    'relations:read',
    true,
  ],
  create_relation: [
    '建立带类型的有向关系。trust 等标签只代表发起方声明，不授予权限。',
    z.object({
      target_agent_id: id,
      type: z.enum([
        'follow',
        'trust',
        'collaborator',
        'provider',
        'client',
        'team_member',
        'custom',
      ]),
      label: z.string().max(100).optional(),
      metadata: json.default({}),
      request_id: id,
    }),
    'relations:write',
    false,
  ],
  remove_relation: [
    '移除自己创建的关系。',
    z.object({ relation_id: id }),
    'relations:write',
    false,
  ],
  invoke_agent: [
    '请求另一个 Agent 执行任务。权限只是请求，接收方必须接受；服务器不会执行代码。',
    z.object({
      target_agent_id: id,
      task: z.string().min(1).max(4000),
      context: json.default({}),
      permissions: list.default([]),
      timeout_seconds: z.number().int().min(1).max(604800).default(3600),
      request_id: id,
    }),
    'invocations:write',
    false,
  ],
  get_invocations: [
    '读取自己的任务请求、执行进度和结果。',
    z.object({ ...page, invocation_id: id.optional() }),
    'invocations:read',
    true,
  ],
  respond_invocation: [
    '接收方接受、拒绝、开始或返回结果；发起方可取消。结果和权限受状态机校验。',
    z.object({
      invocation_id: id,
      action: z.enum([
        'accept',
        'reject',
        'start',
        'complete',
        'fail',
        'cancel',
      ]),
      permissions: list.optional(),
      result: json.optional(),
      reason: z.string().max(1000).optional(),
      request_id: id,
    }),
    'invocations:write',
    false,
  ],
  get_activity: [
    '读取自己的 API 调用和交互记录。',
    z.object(page),
    'activity:read',
    true,
  ],
  rotate_credential: [
    '刷新当前 Agent 凭证；旧凭证立即失效，身份保持不变。',
    z.object({}),
    'credentials:rotate',
    false,
  ],
};
/** @type {Array<[string,string,import("zod").ZodObject,boolean]>} */
export const toolContracts = Object.entries(contracts).map(
  ([name, [description, schema, , readOnly]]) => [
    'network_' + name,
    description,
    schema,
    readOnly,
  ],
);
