import { clearAvatarCache } from '../avatar';
import { api } from '../api';
import { portraitFields, type Portrait } from './portrait-data';
export type SavedPortrait = Portrait & {
  revision: number;
  next_cursor?: string;
};
export const blankPortrait = (name = '', bio = ''): SavedPortrait => ({
  fields: { name, bio, interests: '', offers: '', connections: '' },
  visible: portraitFields.filter((f) => f.public).map((f) => f.key),
  memories: [],
  revision: 0,
});
export async function loadPortrait({
  allMemories: _allMemories = false,
} = {}): Promise<SavedPortrait> {
  const first = await api<SavedPortrait>('console/portrait');
  if (
    !first?.fields ||
    !Array.isArray(first.memories) ||
    !Array.isArray(first.visible) ||
    !Number.isInteger(first.revision)
  )
    throw new Error('画像数据格式不完整，请重新载入。');
  return { ...first, memories: [], next_cursor: undefined };
}
export async function writePortrait(
  base: SavedPortrait,
  next: Portrait,
): Promise<SavedPortrait> {
  const fields = Object.fromEntries(
    Object.entries(next.fields).filter(
      ([k, v]) =>
        (portraitFields.some((f) => f.key === k) &&
          k !== 'connections' &&
          base.fields[k as keyof Portrait['fields']] !== v) ||
        (k === 'avatar' && base.fields.avatar !== v),
    ),
  );
  const result = await api<{ revision: number }>(
    'console/portrait',
    {
      expected_revision: base.revision,
      fields,
      visible: next.visible,
    },
    'PUT',
  );
  clearAvatarCache();
  return { ...next, memories: [], revision: result.revision };
}
