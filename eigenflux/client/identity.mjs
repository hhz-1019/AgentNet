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

// elizaOS character-card fields, kept as host-owned data. Examples demonstrate
// a voice; they are neither conversation history nor evidence of an action.
function text(value, limit, field) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value).length > limit
  )
    throw new Error('Invalid Agent identity field: ' + field);
  return value.trim();
}
function list(value, limit, field, parse) {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error('Invalid Agent identity field: ' + field);
  return value.map(parse);
}
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
  if (value.style !== undefined) {
    if (
      !value.style ||
      typeof value.style !== 'object' ||
      Array.isArray(value.style)
    )
      throw new Error('Invalid Agent identity field: style');
    result.style = {};
    for (const mode of ['all', 'chat', 'post']) {
      if (value.style[mode] !== undefined)
        result.style[mode] = list(value.style[mode], 4, 'style.' + mode, (v) =>
          text(v, 240, 'style.' + mode),
        );
    }
  }
  if (value.postExamples !== undefined)
    result.postExamples = list(value.postExamples, 4, 'postExamples', (v) =>
      text(v, 1200, 'postExamples'),
    );
  if (value.messageExamples !== undefined)
    result.messageExamples = list(
      value.messageExamples,
      4,
      'messageExamples',
      (conversation) => {
        if (!Array.isArray(conversation) || conversation.length < 2)
          throw new Error('Invalid Agent identity field: messageExamples');
        return list(conversation, 6, 'messageExamples', (message) => ({
          name: text(message?.name, 80, 'messageExamples.name'),
          content: {
            text: text(
              message?.content?.text,
              800,
              'messageExamples.content.text',
            ),
          },
        }));
      },
    );
  return result;
}

// Select examples at the host boundary, before any model-specific adapter.
// Retain the complete card on disk, not in every generation request.
export function generationIdentity(value, mode = 'chat') {
  const identity = normalizeIdentity(value);
  if (!identity) return identity;
  if (!['chat', 'post', 'activity'].includes(mode))
    throw new Error('Unknown expression mode');
  if (mode === 'post') delete identity.messageExamples;
  else if (identity.messageExamples)
    identity.messageExamples = identity.messageExamples.slice(0, 2);
  if (mode === 'chat') delete identity.postExamples;
  else if (identity.postExamples)
    identity.postExamples = identity.postExamples.slice(0, 2);
  if (identity.style && mode !== 'activity')
    delete identity.style[mode === 'chat' ? 'post' : 'chat'];
  return identity;
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
    style: saved.style,
    messageExamples: saved.messageExamples,
    postExamples: saved.postExamples,
  });
}
