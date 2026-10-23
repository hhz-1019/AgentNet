import { isPortraitAvatar } from './default-avatars.ts';
import { normalizeDraft } from './onboarding.ts';
import { type TwinProfile } from './twin.ts';
import type { Portrait } from './social/portrait-data.ts';
import type { SavedPortrait } from './social/portrait-api.ts';

const firstText = (...values: unknown[]) =>
  values
    .find(
      (value): value is string => typeof value === 'string' && !!value.trim(),
    )
    ?.trim() || '';

// A reviewed save (including deliberately cleared fields) always wins. Before
// that save, blank placeholders must not erase usable Agent context.
export function prefillPortrait(
  saved: SavedPortrait,
  value: unknown,
  _agentName: string,
): SavedPortrait {
  if (saved.revision) return saved;
  const draft = normalizeDraft(value);
  const rawTwin = (
    draft as typeof draft & {
      twin_profile?: Partial<TwinProfile> & { portrait?: Partial<Portrait> };
    }
  ).twin_profile;
  const portrait = rawTwin?.portrait;
  const fields = portrait?.fields;
  const initial: SavedPortrait = {
    ...saved,
    fields: {
      name: firstText(fields?.name, saved.fields.name),
      bio: firstText(
        fields?.bio,
        saved.fields.bio,
        draft.identity_card.human_description,
      ),
      interests: firstText(fields?.interests, saved.fields.interests),
      offers: firstText(fields?.offers, saved.fields.offers),

      connections: firstText(
        fields?.connections,
        saved.fields.connections,
        draft.network_goal,
      ),
    },
    memories: [],
  };
  initial.fields = {
    ...initial.fields,
    avatar: isPortraitAvatar(fields?.avatar)
      ? fields.avatar
      : isPortraitAvatar(saved.fields.avatar)
        ? saved.fields.avatar
        : '',
  };
  return initial;
}
