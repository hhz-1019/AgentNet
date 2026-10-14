import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: '此刻', version: '1.0.0' }, {});
const config = JSON.parse(document.querySelector('#moment-config').textContent);
const status = document.querySelector('#status');
const frame = document.querySelector('iframe');
const executor = 'chat_' + crypto.randomUUID();
const sent = new Set();
const inflight = new Set();
try {
  await app.connect();
  if (!app.getHostCapabilities()?.message?.text)
    throw new Error('当前宿主不支持向聊天发送消息。');
  const origin = new URL(config.url).origin;
  window.addEventListener('message', (event) => {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== origin ||
      event.data?.type !== 'moment:hello'
    )
      return;
    const channel = new MessageChannel();
    channel.port1.onmessage = async ({ data }) => {
      if (data?.type !== 'moment:send' || !/^\d+$/.test(data.command_id))
        return;
      const reply = (result) =>
        channel.port1.postMessage({ id: data.id, ...result });
      if (data.executor_id !== executor)
        return reply({ error: '这项决定绑定在另一个面板，请回到原面板处理。' });
      if (sent.has(data.command_id)) return reply({ sent: true });
      if (inflight.has(data.command_id))
        return reply({ error: '消息正在发送，请先检查当前聊天。' });
      inflight.add(data.command_id);
      try {
        const result = await app.callServerTool({
          name: 'network_chat_decision_message',
          arguments: {
            command_id: data.command_id,
            executor_id: executor,
          },
        });
        if (result.isError)
          throw new Error('决定已失效、已领取，或面板连接了不同的 Agent。');
        const text = result.structuredContent?.text;
        if (typeof text !== 'string')
          throw new Error('后端没有返回可发送的决定。');
        const accepted = await app.sendMessage({
          role: 'user',
          content: [{ type: 'text', text }],
        });
        if (accepted.isError)
          throw new Error('当前聊天未接受消息，请检查宿主权限。');
        sent.add(data.command_id);
        reply({ sent: true });
      } catch (error) {
        reply({
          error:
            error.message || '发送结果未确认，请先检查聊天，避免重复发送。',
        });
      } finally {
        inflight.delete(data.command_id);
      }
    };
    frame.contentWindow.postMessage(
      { type: 'moment:connected', executor },
      origin,
      [channel.port2],
    );
  });
  frame.src = config.url;
  status.hidden = true;
  frame.hidden = false;
} catch (error) {
  status.textContent = error.message || '无法连接当前聊天。';
}
