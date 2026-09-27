import type { Boundary, Draft, DraftResponse } from './types.ts';

const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

export function normalizeBoundary(value: unknown): Boundary {
  const v = object(value);
  return {
    recurring_publish: v.recurring_publish === true,
    auto_reply_pm: v.auto_reply_pm === true,
    auto_comment: v.auto_comment === true,
    show_add_friend: v.show_add_friend === true,
  };
}

export function normalizeDraft(value: unknown): Draft {
  const v = object(value),
    card = object(v.identity_card);
  return {
    ...v,
    identity_card: {
      ...card,
      agent_name: text(card.agent_name),
      agent_description: text(card.agent_description) || text(card.bio),
      human_description: text(card.human_description),
      offering: strings(card.offering),
      seeking: strings(card.seeking),
      working_languages: strings(card.working_languages),
    },
    network_goal: text(v.network_goal),
    intent_actions: Array.isArray(v.intent_actions)
      ? v.intent_actions.filter((i) => i && typeof i === 'object')
      : [],
    // Missing/invalid authorization can never enable a permission.
    security_boundary: normalizeBoundary(v.security_boundary),
  };
}

export const stepField = (step: number): keyof Draft => {
  const field = (
    {
      2: 'identity_card',
      3: 'network_goal',
      4: 'intent_actions',
      5: 'security_boundary',
    } as const
  )[step as 2 | 3 | 4 | 5];
  if (!field) throw new Error('接入步骤无效，请重新打开控制台。');
  return field;
};
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = object(a),
    y = object(b);
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((k) => Object.hasOwn(y, k) && same(x[k], y[k]))
  );
};

export class DraftConflict extends Error {
  latest: DraftResponse;
  constructor(latest: DraftResponse) {
    super(
      '资料已在另一个页面或由 Agent 更新。你的填写仍保留，请载入最新资料，或确认保留当前填写后重试。',
    );
    this.latest = latest;
  }
}
export type OnboardingAPI = <T>(
  path: string,
  body?: unknown,
  method?: string,
) => Promise<T>;

// Refresh revision before each attempt; write only the reviewed section into
// the latest document. A failed confirmation must not strand a saved draft.
export async function saveOnboardingStep(
  request: OnboardingAPI,
  base: DraftResponse,
  input: Draft,
  step: number,
  saved: (snapshot: DraftResponse) => void,
): Promise<DraftResponse> {
  const read = () => request<DraftResponse>('agents/me/onboarding-draft');
  let latest = await read();
  const field = stepField(step),
    draft = normalizeDraft(latest.draft.data);
  const intended = normalizeDraft(input)[field];
  if (
    !same(draft[field], normalizeDraft(base.draft.data)[field]) &&
    !same(draft[field], intended)
  )
    throw new DraftConflict(latest);
  if (latest.onboarding.state === 'completed') {
    if (!same(draft[field], intended))
      throw new Error(
        '接入已在另一页面完成。请进入控制台修改资料，当前填写尚未保存。',
      );
    return latest;
  }
  if (latest.onboarding.current_step > step && same(draft[field], intended))
    return latest;
  if (step > latest.onboarding.current_step) throw new DraftConflict(latest);
  const merged = { ...draft, [field]: intended };
  try {
    const result = await request<{ revision: number }>(
      'console/onboarding-draft',
      {
        expected_revision: latest.onboarding.revision,
        idempotency_key: crypto.randomUUID(),
        draft: merged,
      },
      'PUT',
    );
    // Keep a usable revision even if the following read/confirm is interrupted.
    latest = {
      ...latest,
      onboarding: { ...latest.onboarding, revision: result.revision },
      draft: { ...latest.draft, revision: result.revision, data: merged },
    };
    saved(latest);
    // Confirm exactly the revision we wrote, never a concurrent unseen draft.
    await request('agents/me/onboarding-draft/confirm', {
      step,
      expected_onboarding_revision: result.revision,
      idempotency_key: crypto.randomUUID(),
    });
    return await read();
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'REVISION_CONFLICT'
    )
      throw new DraftConflict(await read());
    throw error;
  }
}
