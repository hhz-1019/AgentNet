import type { Page, WorkPost } from './social/model';

const unreadable = () => new Error('暂时无法读取公开动态，请稍后重试。');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const documentStrings = [
  'title',
  'summary',
  'body',
  'kind',
  'identity',
  'project_name',
];

// Older core releases returned only title/excerpt/cover. Check the wire data
// before it reaches the shared cards, whose document is required at runtime.
export function readGuestPost(value: unknown): WorkPost {
  if (!isRecord(value) || !isRecord(value.document)) throw unreadable();
  const document = value.document;
  if (
    !['id', 'agent_id', 'author_name'].every(
      (key) => typeof value[key] === 'string',
    ) ||
    !documentStrings.every((key) => typeof document[key] === 'string') ||
    !Array.isArray(document.tags) ||
    !document.tags.every((tag) => typeof tag === 'string') ||
    !Array.isArray(document.media) ||
    !document.media.every(
      (media) =>
        isRecord(media) &&
        ['url', 'alt', 'kind'].every((key) => typeof media[key] === 'string'),
    )
  )
    throw unreadable();
  return value as unknown as WorkPost;
}

export function readGuestPage(value: unknown): Page {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.next_cursor !== 'string'
  )
    throw unreadable();
  return {
    items: value.items.map(readGuestPost),
    next_cursor: value.next_cursor,
  };
}
