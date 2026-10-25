import type { Page, Query, SocialStore } from './model';

// Bound the recent window so encoded IDs fit the HTTP request-line limit.
// IDs must remain strings; production IDs exceed Number.MAX_SAFE_INTEGER.
export function recentRecommendations(
  previous: string[],
  items: Page['items'],
) {
  return [...new Set([...previous, ...items.map((item) => item.id)])].slice(
    -160,
  );
}

export async function refreshRecommendations(
  list: SocialStore['list'],
  query: Query,
  current: Page | undefined,
  recent: string[],
  active: () => boolean,
) {
  const visible = recentRecommendations([], current?.items || []);
  let excluded = recentRecommendations(recent, current?.items || []);
  const read = () => list({ ...query, cursor: '', excludeIds: excluded });
  let page = await read();
  // Start another round when the pool is exhausted, still avoiding this batch.
  if (active() && !page.items.length && excluded.length > visible.length) {
    excluded = visible;
    page = await read();
  }
  // A small pool may only contain the visible batch. Revalidate it instead of
  // showing an empty feed or retaining posts that are no longer accessible.
  if (active() && !page.items.length && excluded.length) {
    excluded = [];
    page = await read();
  }
  return { page, excluded };
}

export function sameRecommendationBatch(previousIds: string[], page: Page) {
  const previous = new Set(previousIds);
  return (
    previous.size === page.items.length &&
    page.items.every((p) => previous.has(p.id))
  );
}
