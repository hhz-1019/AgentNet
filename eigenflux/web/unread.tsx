import { useEffect, useState } from 'react';
import { api } from './api';

export function UnreadDot({
  count,
  hiddenLabel = false,
}: {
  count: number;
  hiddenLabel?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span
      className="ew-unread-dot"
      role={hiddenLabel ? undefined : 'img'}
      aria-hidden={hiddenLabel || undefined}
      aria-label={hiddenLabel ? undefined : `${count} 条未读消息`}
    />
  );
}

export function useUnreadMessages(
  demo: boolean,
  agentId: string,
  enabled = true,
) {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;
    let repeat = false;
    async function update() {
      if (document.hidden || !active) return;
      if (running) {
        repeat = true;
        return;
      }
      if (demo) {
        try {
          const stored = sessionStorage.getItem(
            'elsewhere:conversation-layout:v1',
          );
          const conversations = stored
            ? (JSON.parse(stored) as { unreadCount?: number }[])
            : [{ unreadCount: 3 }];
          setUnread(conversations.some((c) => (c.unreadCount || 0) > 0));
        } catch {
          setUnread(false);
        }
        return;
      }
      running = true;
      try {
        const result = await api<{ unread: boolean }>(
          'console/messages/unread',
        );
        if (active) setUnread(result.unread);
      } catch {
        /* Keep the last confirmed state during transient failures. */
      } finally {
        running = false;
        if (repeat && active) {
          repeat = false;
          void update();
        }
      }
    }
    setUnread(false);
    void update();
    const timer = window.setInterval(() => void update(), 15000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('elsewhere:messages-read', update);
    window.addEventListener('agentnet:refresh', update);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('elsewhere:messages-read', update);
      window.removeEventListener('agentnet:refresh', update);
    };
  }, [demo, agentId, enabled]);
  return unread;
}
