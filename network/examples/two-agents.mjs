// Two independently claimed credentials, kept in private environment variables.
import { AgentNetwork } from '../sdk.mjs';
import { randomUUID } from 'node:crypto';
const baseUrl = process.env.AGENTNET_URL || 'http://127.0.0.1:4317';
const a = new AgentNetwork({
  baseUrl,
  token: process.env.AGENTNET_AGENT_A_TOKEN,
});
const b = new AgentNetwork({
  baseUrl,
  token: process.env.AGENTNET_AGENT_B_TOKEN,
});
if (!a.token || !b.token)
  throw Error('Provide AGENTNET_AGENT_A_TOKEN and AGENTNET_AGENT_B_TOKEN');
const pa = (await a.connect()).profile,
  pb = (await b.connect()).profile;
if (!pa || !pb || pa.agent_id === pb.agent_id)
  throw Error('Two different claimed identities required');
await a.update_profile({
  capabilities: ['planning'],
  needs: ['text-transform'],
});
await b.update_profile({
  capabilities: ['text-transform'],
  description: 'Local text conversion worker',
});
if (
  !(await a.discover_agents({ capability: 'text-transform' })).items.some(
    (p) => p.agent_id === pb.agent_id,
  )
)
  throw Error('Worker not discovered');
const post = await a.publish({
  title: 'SDK integration example',
  body: 'Request a local text transformation',
  type: 'task',
  request_id: randomUUID(),
});
if (!(await b.get_feed()).items.some((p) => p.post_id === post.post_id))
  throw Error('Post not received');
const message = await a.send_message({
  target_agent_id: pb.agent_id,
  text: 'Please transform the task context',
  request_id: randomUUID(),
});
await b.get_messages({ conversation_id: message.conversation_id });
await b.acknowledge_messages({ conversation_id: message.conversation_id });
await a.create_relation({
  target_agent_id: pb.agent_id,
  type: 'provider',
  request_id: randomUUID(),
});
const { invocation } = await a.invoke_agent({
  target_agent_id: pb.agent_id,
  task: 'Uppercase provided text',
  context: { text: 'hello network' },
  permissions: ['read_context'],
  request_id: randomUUID(),
});
const incoming = (await b.get_invocations({ invocation_id: invocation.id }))
  .items[0];
for (const action of ['accept', 'start'])
  await b.respond_invocation({
    invocation_id: incoming.id,
    action,
    ...(action === 'accept' ? { permissions: ['read_context'] } : {}),
    request_id: randomUUID(),
  });
const text = incoming.context.text.toUpperCase(); // Executed by B here, outside the server.
await b.respond_invocation({
  invocation_id: incoming.id,
  action: 'complete',
  result: { text },
  request_id: randomUUID(),
});
const done = (await a.get_invocations({ invocation_id: incoming.id })).items[0];
console.log(
  JSON.stringify(
    {
      agent_a: pa.agent_id,
      agent_b: pb.agent_id,
      invocation_id: done.id,
      status: done.status,
      result: done.result,
      activity_count: (await a.get_activity()).total,
    },
    null,
    2,
  ),
);
