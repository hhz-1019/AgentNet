import type { Page } from './model';

// Keep exact string IDs: production IDs exceed JavaScript's safe integers.
export function mergeFeedPage(
  previous: Page | undefined,
  incoming: Page,
  mode: 'replace' | 'append' | 'refresh',
  cursor = '',
): Page {
  if (!previous || mode === 'replace') return incoming;
  const byId = new Map(incoming.items.map((post) => [post.id, post]));
  const oldIds = new Set(previous.items.map((post) => post.id));
  const refreshed = previous.items.map((post) => {
    const next = byId.get(post.id);
    return next && JSON.stringify(next) !== JSON.stringify(post) ? next : post;
  });
  const added = incoming.items.filter((post) => !oldIds.has(post.id));
  const result = {
    items:
      mode === 'refresh' ? [...added, ...refreshed] : [...refreshed, ...added],
    next_cursor:
      mode === 'refresh'
        ? previous.next_cursor || (added.length ? incoming.next_cursor : '')
        : incoming.next_cursor === cursor
          ? ''
          : incoming.next_cursor,
  };
  return !added.length &&
    refreshed.every((post, index) => post === previous.items[index]) &&
    result.next_cursor === previous.next_cursor
    ? previous
    : result;
}
