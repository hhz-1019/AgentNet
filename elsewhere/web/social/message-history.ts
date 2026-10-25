import { useLayoutEffect, useRef, useState } from 'react';

export type ReadingPosition = {
  top: number;
  height: number;
  followsLatest: boolean;
  ids: string[];
  unread: number;
};

// Kept only for this page session; returning from a person's page restores reading.
const positions = new Map<string, ReadingPosition>();

export function reconcileMessageHistory(
  previous: ReadingPosition | undefined,
  ids: string[],
  height: number,
  viewport: number,
  changedConversation: boolean,
): ReadingPosition {
  const previousLast = previous?.ids.at(-1);
  const previousLastIndex = previousLast ? ids.indexOf(previousLast) : -1;
  const added = previousLastIndex >= 0 ? ids.length - previousLastIndex - 1 : 0;
  const followsLatest = !previous || previous.followsLatest;
  let top = previous?.top || 0;
  let unread = previous?.unread || 0;
  if (followsLatest) {
    top = Math.max(0, height - viewport);
    unread = 0;
  } else if (previous) {
    const firstIndex = previous.ids.length ? ids.indexOf(previous.ids[0]) : -1;
    if (!changedConversation && firstIndex > 0) top += height - previous.height;
    unread += added;
  }
  return { top, height, followsLatest, ids: [...ids], unread };
}

export function useMessageHistory(key: string, ids: string[], ready = true) {
  const ref = useRef<HTMLDivElement>(null);
  const activeKey = useRef('');
  const [unread, setUnread] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !key || !ready) return;
    const previous = positions.get(key);
    const changedConversation = activeKey.current !== key;
    const next = reconcileMessageHistory(
      previous,
      ids,
      el.scrollHeight,
      el.clientHeight,
      changedConversation,
    );
    el.scrollTop = next.top;
    positions.set(key, next);
    activeKey.current = key;
    setUnread(next.unread);
  }, [key, ids, ready]);

  function onScroll() {
    const el = ref.current;
    const position = positions.get(key);
    if (!el || !position) return;
    position.top = el.scrollTop;
    position.height = el.scrollHeight;
    position.followsLatest =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (position.followsLatest && position.unread) {
      position.unread = 0;
      setUnread(0);
    }
  }

  function jumpToLatest() {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    onScroll();
    setUnread(0);
  }

  return { ref, unread, onScroll, jumpToLatest };
}
