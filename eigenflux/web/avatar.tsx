import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { avatarUrl, isPortraitAvatar, defaultAvatars } from './default-avatars';
import { AvatarCache, type AvatarPreview } from './avatar-cache';
import { ProgressiveImage } from './social/progressive-image';
import './avatar.css';

const cache = new AvatarCache();
export const AvatarLookupContext = createContext<boolean | 'guest'>(true);
const pending = new Set<string>();
const inFlight = new Set<string>();
let generation = 0;
const listeners = new Set<() => void>();
const lookups = new Set<() => void>();
let refreshTimer: number | undefined;
const refreshLookups = () => { if (!document.hidden) lookups.forEach((lookup) => lookup()); };
function watchLookup(lookup: () => void) {
  lookups.add(lookup);
  if (refreshTimer === undefined) {
    refreshTimer = window.setInterval(refreshLookups, 15_000);
    window.addEventListener('focus', refreshLookups);
  }
  return () => {
    lookups.delete(lookup);
    if (!lookups.size) {
      window.clearInterval(refreshTimer);
      refreshTimer = undefined;
      window.removeEventListener('focus', refreshLookups);
    }
  };
}
let scheduled = false;
async function flushAvatars() {
  scheduled = false;
  const scope = [...pending][0]?.split(':')[0];
  const keys = [...pending]
    .filter((key) => key.startsWith(scope + ':'))
    .slice(0, 100);
  const ids = keys.map((key) => key.split(':')[1]);
  const startedAt = generation;
  keys.forEach((key) => {
    pending.delete(key);
    inFlight.add(key);
  });
  if (!ids.length) return;
  try {
    const response = await api<{
      avatars: Record<string, string>;
      previews?: Record<string, AvatarPreview>;
    }>(`${scope}/avatars?ids=${ids.join(',')}`);
    if (startedAt !== generation) return;
    let changed = false;
    keys.forEach((key, i) => {
      if (
        cache.set(
          key,
          response.avatars[ids[i]] || '',
          Date.now(),
          response.previews?.[ids[i]],
        )
      )
        changed = true;
    });
    if (changed) listeners.forEach((notify) => notify());
  } catch {
    // Keep the last image; mounted avatars retry without refreshing the page.
    if (startedAt === generation) {
      keys.forEach((key) => {
        if (cache.get(key) === undefined) cache.set(key, '');
      });
      listeners.forEach((notify) => notify());
    }
  } finally {
    if (startedAt === generation) keys.forEach((key) => inFlight.delete(key));
  }
  if (pending.size) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => void flushAvatars());
}
export function rememberAvatar(agentId: string, avatar: string) {
  const key = `console:${agentId}`;
  if (cache.get(key) === avatar) return;
  // Show the known URL immediately, but still fetch its tiny preview.
  cache.set(key, avatar, Date.now() - 300_001);
  listeners.forEach((notify) => notify());
  refreshLookups();
}
export function clearAvatarCache() {
  generation++;
  cache.clear();
  pending.clear();
  inFlight.clear();
  listeners.forEach((notify) => notify());
  refreshLookups();
}
export function AgentAvatar({
  agentId = '',
  avatar,
  portrait,
  className = '',
}: {
  agentId?: string;
  avatar?: string;
  portrait?: AvatarPreview;
  name?: string;
  className?: string;
}) {
  const [, update] = useState(0);
  const allowLookup = useContext(AvatarLookupContext);
  const key = `${allowLookup === 'guest' ? 'guest' : 'console'}:${agentId}`;
  const known = cache.get(key);
  const canLookup = Boolean(!portrait && allowLookup && /^\d+$/.test(agentId));
  useEffect(() => {
    if (!canLookup) return;
    const notify = () => update((n) => n + 1);
    listeners.add(notify);
    const lookup = () => {
      if (/^\d+$/.test(agentId) && !cache.fresh(key) && !inFlight.has(key)) {
        pending.add(key);
        schedule();
      }
    };
    lookup();
    const unwatch = watchLookup(lookup);
    return () => {
      listeners.delete(notify);
      unwatch();
    };
  }, [agentId, canLookup, key]);
  const value = portrait?.avatar ?? avatar ?? known;
  const metadata = portrait ?? cache.image(key);
  const image = metadata?.avatar === value ? metadata : undefined;
  const color =
    image?.color || defaultAvatars.find((item) => item.id === value)?.colors[0];
  return (
    <span
      className={`ew-avatar-image ew-avatar-frame ${className}`}
      aria-hidden="true"
    >
      {isPortraitAvatar(value) && (
        <ProgressiveImage
          key={value}
          media={{
            url: avatarUrl(value),
            kind: 'image',
            alt: '',
            preview: image?.preview,
            color,
          }}
          onError={() => {}}
        />
      )}
    </span>
  );
}
