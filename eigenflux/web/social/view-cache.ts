import type { Page } from './model';
export type FeedView = {
  page: Page;
  cursor: string;
  query: string;
  search: string;
  topic: string;
  feed: string;
  scroll: number;
};
export class FeedViewCache {
  private views = new Map<string, { view: FeedView; expires: number }>();
  set(route: string, view: FeedView, now = Date.now()) {
    this.views.delete(route);
    // Bound retained history without truncating the currently visible feed.
    if (view.page.items.length > 300) return;
    this.views.set(route, { view, expires: now + 120_000 });
    while (this.views.size > 4)
      this.views.delete(this.views.keys().next().value!);
  }
  get(route: string, now = Date.now()) {
    const saved = this.views.get(route);
    if (!saved) return;
    if (saved.expires <= now) {
      this.views.delete(route);
      return;
    }
    return saved.view;
  }
}
