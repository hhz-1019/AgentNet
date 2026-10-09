import { normalizeDraft } from './onboarding.ts';
import { normalizeTwin, type TwinProfile } from './twin.ts';
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
  agentName: string,
): SavedPortrait {
  if (saved.revision) return saved;
  const draft = normalizeDraft(value);
  const rawTwin = (
    draft as typeof draft & {
      twin_profile?: Partial<TwinProfile> & { portrait?: Partial<Portrait> };
    }
  ).twin_profile;
  const twin = normalizeTwin(rawTwin);
  const portrait = rawTwin?.portrait;
  const fields = portrait?.fields;
  const initial = {
    ...saved,
    fields: {
      name: firstText(
        fields?.name,
        saved.fields.name,
        twin.name,
        draft.identity_card.agent_name,
        agentName,
      ),
      bio: firstText(
        fields?.bio,
        saved.fields.bio,
        draft.identity_card.human_description,
        draft.identity_card.agent_description,
      ),
      interests: firstText(
        fields?.interests,
        saved.fields.interests,
        twin.basic_info.interests,
      ),
      role: firstText(fields?.role, saved.fields.role, twin.basic_info.role),
      values: firstText(fields?.values, saved.fields.values),
      recent: firstText(
        fields?.recent,
        saved.fields.recent,
        twin.current_goal,
        draft.network_goal,
      ),
    },
    memories: saved.memories,
  };
  if (!saved.memories.length) {
    const supplied = portrait?.memories?.filter((m) => m.content?.trim());
    initial.memories = (supplied?.length ? supplied : twin.episodes).map(
      (m) => ({
        id: m.id,
        content: m.content,
        showOnHome: false,
        source: 'self' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  }
  return initial;
}
