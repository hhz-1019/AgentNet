import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageSources, imageLead } from './image-loading.ts';
import { FeedViewCache, type FeedView } from './view-cache.ts';

await test('responsive images only use permission-checked hosted media', () => {
  const url = '/api/v2/console/social/media/369018210344763392';
  assert.equal(imageSources(url).src, url + '?w=640');
  assert.equal(imageSources(url, true).src, url + '?w=1440');
  assert.match(imageSources(url).srcSet!, /960w/);
  assert.deepEqual(imageSources('https://example.com/a.jpg'), {
    src: 'https://example.com/a.jpg',
  });
  assert.deepEqual(imageSources('/api/v2/public/avatars/abc'), {
    src: '/api/v2/public/avatars/abc',
  });
  assert.ok(imageLead(900) > 900);
  assert.ok(imageLead(900, true) > imageLead(900));
  assert.equal(imageLead(5000, true), 3000);
});
await test('feed return retains filters, pagination and position, bounded by age and count', () => {
  const cache = new FeedViewCache();
  const view: FeedView = {
    page: { items: [], next_cursor: 'next' },
    cursor: 'previous',
    query: '猫',
    search: '猫',
    topic: '',
    feed: 'latest',
    scroll: 2000,
  };
  cache.set('explore', view, 100);
  assert.equal(cache.get('explore', 101), view);
  assert.equal(cache.get('explore', 120101), undefined);
  for (let i = 0; i < 5; i++) cache.set(String(i), view, 100);
  assert.equal(cache.get('0', 101), undefined);
  cache.clear();
  assert.equal(cache.get('4', 101), undefined, 'writes invalidate retained feed views');
});
