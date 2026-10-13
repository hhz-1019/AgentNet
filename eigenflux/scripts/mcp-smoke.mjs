import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { assertAcceptanceTarget } from './acceptance-target.mjs';

const state = JSON.parse(
  await readFile('.agentnet-audit/core-smoke-state.json', 'utf8'),
);
assertAcceptanceTarget(state.endpoint);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('eigenflux/client/mcp.mjs')],
  env: {
    ...process.env,
    AGENTNET_CLI: resolve(
      process.env.AGENTNET_CLI || '.agentnet-audit/bin/agentnet-cli.exe',
    ),
    AGENTNET_HOME: resolve(state.directory, 'Atlas'),
    AGENTNET_URL: state.endpoint,
  },
});
const client = new Client({
  name: 'agentnet-protocol-verifier',
  version: '1.0.0',
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  // New tools are compatible; removing or corrupting an existing tool is not.
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.match(tool.name, /^network_[a-z_]+$/);
    assert.equal(
      tool.inputSchema?.type,
      'object',
      `${tool.name} has no object schema`,
    );
  }
  for (const name of [
    'network_upload_avatar',
    'network_get_companion',
    'network_rename_companion',
    'network_share_post',
    'network_get_post',
    'network_get_comments',
    'network_comment',
    'network_react',
    'network_get_person',
    'network_follow',
    'network_send_handoff',
    'network_get_handoffs',
    'network_get_handoff',
    'network_acknowledge_handoff',
    'network_propose_post',
    'network_record_work',
    'network_get_work_posts',
    'network_request_decision',
    'network_register_agent',
    'network_get_profile',
    'network_get_profile_context',
    'network_update_profile',
    'network_get_context',
    'network_get_feed',
    'network_publish',
    'network_get_messages',
    'network_send_message',
    'network_get_relations',
    'network_create_relation',
    'network_get_relation_requests',
    'network_respond_relation',
    'network_heartbeat',
    'network_pending_commands',
    'network_claim_command',
    'network_complete_command',
    'network_dashboard',
    'network_share_work',
    'network_upload_image',
    'network_get_portrait',
    'network_sync_portrait',
    'network_get_groups',
    'network_create_group',
    'network_get_group_messages',
    'network_send_group_message',
  ]) {
    assert(
      tools.some((tool) => tool.name === name),
      `${name} is missing`,
    );
  }
  for (const name of [
    'network_get_profile',
    'network_get_companion',
    'network_get_portrait',
    'network_get_groups',
    'network_get_context',
    'network_get_relations',
    'network_get_messages',
    'network_heartbeat',
  ]) {
    const result = await client.callTool({ name, arguments: {} });
    assert(!result.isError, `${name} returned an error`);
    assert(result.content?.length);
    console.log(
      `PASS: MCP ${name} through actual stdio protocol and network services`,
    );
  }
  const call = async (name, args = {}) => {
    const result = await client.callTool({
      name: 'network_' + name,
      arguments: args,
    });
    assert(!result.isError, name + ': ' + result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const image = await call('upload_image', {
    local_path: resolve('eigenflux/web/public/preview-assets/linjian.png'),
    alt: '明确标注的模拟头像验收配图',
    kind: 'image',
  });
  const document = {
    title: '隔离验收：想聊重读小说留下的问题',
    summary: '这是一条明确标注的模拟兴趣交流帖子，用于验证图片和互动接口。',
    body: '这是隔离验收材料：模拟主人喜欢重读小说，希望从一个具体的读后问题认识愿意慢慢交流的人。这条内容不代表真实用户经历，不联系真实用户。',
    kind: 'question',
    tags: ['阅读'],
    source: '隔离测试的模拟兴趣材料',
    evidence: '本次验收构造的数据，非真实用户经历',
    media: [image.media || image],
    identity: 'agent',
    project_name: '',
  };
  const key = crypto.randomUUID();
  const post = await call('share_post', {
    document,
    idempotency_key: key,
    visibility: 'public',
    owner_authorized: true,
  });
  assert.equal(post.state, 'published');
  assert.equal(
    (
      await call('share_post', {
        document,
        idempotency_key: key,
        visibility: 'public',
        owner_authorized: true,
      })
    ).id,
    post.id,
  );
  assert.equal((await call('get_post', { post_id: post.id })).post.id, post.id);
  const commentKey = crypto.randomUUID();
  await call('comment', {
    post_id: post.id,
    content: '模拟验收评论：愿意从读后留下的问题开始聊。',
    idempotency_key: commentKey,
  });
  await call('comment', {
    post_id: post.id,
    content: '模拟验收评论：愿意从读后留下的问题开始聊。',
    idempotency_key: commentKey,
  });
  assert.equal(
    (await call('get_comments', { post_id: post.id })).items.length,
    1,
  );
  await call('react', { post_id: post.id, kind: 'like', active: true });
  await call('react', { post_id: post.id, kind: 'save', active: true });
  assert.equal((await call('get_post', { post_id: post.id })).post.saved, true);
  await call('get_person', { agent_id: state.b.id });
  await call('follow', { agent_id: state.b.id, following: true });
  assert.equal(
    (await call('get_person', { agent_id: state.b.id })).following,
    true,
  );
  const group = await call('create_group', {
    name: '隔离验收阅读交流',
    members: [state.b.id],
    idempotency_key: crypto.randomUUID(),
  });
  await call('send_group_message', {
    group_id: group.group_id,
    content: '明确标注的隔离验收群消息',
    idempotency_key: crypto.randomUUID(),
  });
  assert(
    JSON.stringify(
      await call('get_group_messages', { group_id: group.group_id }),
    ).includes('隔离验收群消息'),
  );
  const portrait = await call('get_portrait');
  await call('sync_portrait', {
    expected_revision: portrait.revision,
    upserts: [
      {
        id: crypto.randomUUID(),
        content: '模拟验收新记忆：网络互动链路完成，不能当作真实主人经历。',
        showOnHome: false,
      },
    ],
  });
  assert(JSON.stringify(await call('get_portrait')).includes('模拟验收新记忆'));
  console.log(
    'PASS: real MCP + CLI + services: image post, idempotent comments, likes/saves, public profile, follow, group, private memory',
  );
  const invalid = await client.callTool({
    name: 'network_send_message',
    arguments: {
      content: 'Do not send this',
      receiver_id: state.b.id,
      conversation_id: '1',
    },
  });
  assert.equal(invalid.isError, true);
  console.log('PASS: ambiguous destination rejected before sending');
} finally {
  await client.close();
}
