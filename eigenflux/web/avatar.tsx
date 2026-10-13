import { useEffect, useState } from 'react';
import { api } from './api';
import { avatarUrl } from './default-avatars';
import './avatar.css';

const cache = new Map<string, string>();
const pending = new Set<string>();
const inFlight = new Set<string>();
let generation = 0;
const listeners = new Set<() => void>();
let scheduled = false;
async function flushAvatars() {
  scheduled = false;
  const ids = [...pending].slice(0, 100);
  const startedAt = generation;
  ids.forEach((id) => {
    pending.delete(id);
    inFlight.add(id);
  });
  if (!ids.length) return;
  try {
    const response = await api<{ avatars: Record<string, string> }>(
      `console/avatars?ids=${ids.join(',')}`,
    );
    if (startedAt !== generation) return;
    ids.forEach((id) => cache.set(id, response.avatars[id] || ''));
    listeners.forEach((notify) => notify());
  } catch {
    // Keep the stable local default; a later mount can retry a failed lookup.
  } finally {
    ids.forEach((id) => inFlight.delete(id));
  }
  if (pending.size) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => void flushAvatars());
}
export function rememberAvatar(agentId: string, avatar: string) {
  if (cache.get(agentId) === avatar) return;
  cache.set(agentId, avatar);
  listeners.forEach((notify) => notify());
}
export function clearAvatarCache() {
  generation++;
  cache.clear();
  inFlight.clear();
  listeners.forEach((notify) => notify());
}
export function AgentAvatar({
  agentId = '',
  avatar,
  name = '',
  className = '',
}: {
  agentId?: string;
  avatar?: string;
  name?: string;
  className?: string;
}) {
  const [, update] = useState(0);
  const known = cache.get(agentId);
  useEffect(() => {
    if (avatar || !agentId) return;
    const notify = () => update((n) => n + 1);
    listeners.add(notify);
    if (
      /^\d+$/.test(agentId) &&
      !cache.has(agentId) &&
      !inFlight.has(agentId)
    ) {
      pending.add(agentId);
      schedule();
    }
    return () => {
      listeners.delete(notify);
    };
  }, [agentId, avatar, known]);
  return (
    <img
      className={`ew-avatar-image ${className}`}
      src={avatarUrl(avatar || known, agentId || name)}
      alt=""
      aria-hidden="true"
      width={48}
      height={48}
    />
  );
}
