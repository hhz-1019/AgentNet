import { portraitFields, type Portrait } from './social/portrait-data.ts';
export function mergeLegacyPortrait<T extends Portrait>(profile: T): T {
  const allowed = new Set<string>(portraitFields.map((f) => f.key));
  return {
    ...profile,
    fields: { ...profile.fields, role: '', values: '', recent: '' },
    memories: [],
    visible: profile.visible.filter((k) => allowed.has(k)),
  };
}
