import type { Portrait, PortraitField } from './social/portrait-data';

// Merge old fields only in the editable view; retain raw server values so save
// can diff correctly. Private material must not become public through merging.
export function mergeLegacyPortrait<T extends Portrait>(profile: T): T {
  const fields = { ...profile.fields };
  let visible = [...profile.visible];
  for (const [oldKey, nextKey] of [
    ['values', 'interests'],
    ['role', 'bio'],
  ] as const) {
    const previous = fields[oldKey]?.trim();
    if (!previous) continue;
    fields[oldKey] = '';
    if (fields[nextKey].includes(previous)) continue;
    fields[nextKey] = [fields[nextKey], previous].filter(Boolean).join('\n\n');
    if (!(profile.visible as string[]).includes(oldKey))
      visible = visible.filter((k) => k !== nextKey);
  }
  visible = visible.filter(
    (k) => !['role', 'values'].includes(k as string),
  ) as PortraitField[];
  return { ...profile, fields, visible };
}
