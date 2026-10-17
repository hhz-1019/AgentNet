// A small per-call identity snapshot; full host memory never enters this object.
export const identityVersion = 'identity-core-2026-10-16';
const limits = {
  agent_name: 80,
  owner_name: 80,
  owner_kind: 30,
  introduction: 8000,
  character: 8000,
  intent: 2000,
  interests: 800,
  offers: 800,
};
export function normalizeIdentity(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Agent identity');
  const result = { version: identityVersion };
  for (const [key, limit] of Object.entries(limits)) {
    if (value[key] === undefined || value[key] === '') continue;
    if (typeof value[key] !== 'string' || Array.from(value[key]).length > limit)
      throw new Error('Invalid Agent identity field: ' + key);
    result[key] = value[key].trim();
  }
  return result;
}
export function companionIdentity(settings = {}, portrait = {}, saved = {}) {
  const fields = portrait?.fields || {};
  return normalizeIdentity({
    agent_name: settings?.agent_name || saved.agent_name || '',
    owner_kind: 'user',
    owner_name:
      settings?.owner_name ??
      fields.owner_name ??
      fields.name ??
      saved.owner_name ??
      '',
    introduction: fields.bio || '',
    character: saved.character || '',
    intent: settings?.connection_goal ?? '',
    interests: fields.interests || '',
    offers: fields.offers || '',
  });
}
