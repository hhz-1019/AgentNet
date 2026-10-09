import { api } from '../api';
import { portraitFields, type Portrait } from './portrait-data';
export type SavedPortrait = Portrait & {
  revision: number;
  next_cursor?: string;
};
export const blankPortrait = (name = '', bio = ''): SavedPortrait => ({
  fields: { name, bio, interests: '', role: '', values: '', recent: '' },
  visible: portraitFields.filter((f) => f.public).map((f) => f.key),
  memories: [],
  revision: 0,
});
export async function loadPortrait(): Promise<SavedPortrait> {
  const first = await api<SavedPortrait>('console/portrait');
  if (!first?.fields || !Array.isArray(first.memories) || !Array.isArray(first.visible) || !Number.isInteger(first.revision)) throw new Error('画像数据格式不完整，请重新载入。');
  let cursor = first.next_cursor;
  while (cursor) {
    const page = await api<SavedPortrait>(
      `console/portrait?cursor=${encodeURIComponent(cursor)}`,
    );
    if (page.revision !== first.revision)
      throw new Error('资料正在更新，请重新载入。');
    first.memories.push(...page.memories);
    cursor = page.next_cursor;
  }
  return first;
}
export async function writePortrait(
  base: SavedPortrait,
  next: Portrait,
): Promise<SavedPortrait> {
  const previous = new Map(base.memories.map((m) => [m.id, m]));
  const ids = new Set(next.memories.map((m) => m.id));
  const fields = Object.fromEntries(
    Object.entries(next.fields).filter(
      ([k, v]) => base.fields[k as keyof Portrait['fields']] !== v,
    ),
  );
  const result = await api<{ revision: number }>(
    'console/portrait',
    {
      expected_revision: base.revision,
      fields,
      visible: next.visible,
      upserts: next.memories.filter((m) => {
        const old = previous.get(m.id);
        return (
          !old || old.content !== m.content || old.showOnHome !== m.showOnHome
        );
      }),
      deletes: base.memories.filter((m) => !ids.has(m.id)).map((m) => m.id),
    },
    'PUT',
  );
  return { ...next, revision: result.revision };
}
