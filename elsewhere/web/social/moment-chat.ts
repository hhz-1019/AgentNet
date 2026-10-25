import { useEffect, useRef, useState } from 'react';

// This is a channel to our MCP App wrapper, not access to the browser's parent
// DOM or an undocumented desktop API. Ordinary browser tabs have no channel.
export function useMomentChat() {
  const port = useRef<MessagePort | null>(null);
  const [executor, setExecutor] = useState('');
  const calls = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  useEffect(() => {
    const pendingCalls = calls.current;
    if (window.parent === window) return;
    const connect = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.data?.type !== 'moment:connected' ||
        !/^chat_[a-f0-9-]{36}$/.test(event.data.executor) ||
        !event.ports[0] ||
        port.current
      )
        return;
      port.current = event.ports[0];
      setExecutor(event.data.executor);
      port.current.onmessage = ({ data }) => {
        const call = calls.current.get(data?.id);
        if (!call) return;
        calls.current.delete(data.id);
        clearTimeout(call.timer);
        if (data.sent === true) call.resolve();
        else
          call.reject(
            new Error(data.error || '发送结果未确认，请检查当前聊天。'),
          );
      };
    };
    window.addEventListener('message', connect);
    window.parent.postMessage({ type: 'moment:hello' }, '*');
    return () => {
      window.removeEventListener('message', connect);
      port.current?.close();
      port.current = null;
      for (const call of pendingCalls.values()) {
        clearTimeout(call.timer);
        call.reject(new Error('面板连接已关闭。'));
      }
      pendingCalls.clear();
    };
  }, []);
  return {
    executor,
    async send(command_id: string, executor_id = executor) {
      if (!port.current || !executor)
        throw new Error(
          '当前页面尚未连接聊天。请从聊天侧栏打开「此刻」后再确认。',
        );
      if (executor_id !== executor)
        throw new Error(
          '请回到保存这项审批的原面板发送，或撤回后在本面板重新确认。',
        );
      await new Promise<void>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          calls.current.delete(id);
          reject(
            new Error('消息发送结果未确认。请先检查当前聊天，再决定是否重试。'),
          );
        }, 30000);
        calls.current.set(id, { resolve, reject, timer });
        port.current!.postMessage({
          type: 'moment:send',
          id,
          command_id,
          executor_id,
        });
      });
    },
  };
}
