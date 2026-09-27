import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDraft,
  normalizeBoundary,
  saveOnboardingStep,
  DraftConflict,
} from './onboarding.ts';
import type { OnboardingAPI } from './onboarding.ts';
import type { DraftResponse } from './types.ts';

function fixture() {
  let state: DraftResponse = {
    onboarding: { state: 'in_progress', current_step: 2, revision: 1 },
    draft: {
      revision: 1,
      data: normalizeDraft({ identity_card: { agent_name: 'Test' } }),
    },
  };
  let writes = 0,
    confirms = 0;
  let failure = '';
  const request: OnboardingAPI = async <T>(path: string, body?: unknown) => {
    const value = body as {
      draft: DraftResponse['draft']['data'];
      expected_revision: number;
      expected_onboarding_revision: number;
      step: number;
    };
    if (!body) return structuredClone(state) as T;
    if (path === 'console/onboarding-draft') {
      assert.equal(value.expected_revision, state.onboarding.revision);
      writes++;
      state = {
        ...state,
        onboarding: {
          ...state.onboarding,
          revision: state.onboarding.revision + 1,
        },
        draft: { revision: state.onboarding.revision + 1, data: value.draft },
      };
      if (failure === 'losePut') {
        failure = '';
        throw new Error('response lost');
      }
      return { revision: state.onboarding.revision } as T;
    }
    if (failure === 'race') {
      failure = '';
      state.onboarding.revision++;
      throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' });
    }
    assert.equal(value.expected_onboarding_revision, state.onboarding.revision);
    if (failure === 'validation') {
      failure = '';
      throw new Error('validation failed');
    }
    confirms++;
    state.onboarding.revision++;
    state.draft.revision = state.onboarding.revision;
    state.onboarding.current_step = Math.max(
      state.onboarding.current_step,
      value.step + 1,
    );
    if (value.step === 5) state.onboarding.state = 'completed';
    if (failure === 'loseConfirm') {
      failure = '';
      throw new Error('confirmation response lost');
    }
    return {} as T;
  };
  return {
    request,
    read: () => structuredClone(state),
    set: (v: DraftResponse) => {
      state = v;
    },
    counts: () => ({ writes, confirms }),
    fail: (v: string) => {
      failure = v;
    },
  };
}

await test('missing/null permissions default to false; truthy strings never grant access', () => {
  for (const raw of [undefined, null, {}, { security_boundary: null }]) {
    assert.deepEqual(Object.values(normalizeDraft(raw).security_boundary), [
      false,
      false,
      false,
      false,
    ]);
    assert.deepEqual(normalizeDraft(raw).intent_actions, []);
  }
  assert.equal(
    normalizeBoundary({ auto_reply_pm: 'true' }).auto_reply_pm,
    false,
  );
  assert.equal(normalizeBoundary({ auto_reply_pm: true }).auto_reply_pm, true);
});
await test('failed confirm resumes from saved draft without stale revision', async () => {
  const f = fixture();
  let base = f.read();
  const input = normalizeDraft(base.draft.data);
  input.identity_card.agent_name = 'Edited';
  f.fail('validation');
  await assert.rejects(
    saveOnboardingStep(f.request, base, input, 2, (v) => {
      base = v;
    }),
    /validation/,
  );
  assert.equal(base.onboarding.revision, 2);
  const result = await saveOnboardingStep(f.request, base, input, 2, () => {});
  assert.equal(result.onboarding.current_step, 3);
  assert.equal(result.draft.data.identity_card.agent_name, 'Edited');
});
await test('a concurrent change on another step survives stale form submission', async () => {
  const f = fixture(),
    base = f.read(),
    input = normalizeDraft(base.draft.data);
  const remote = f.read();
  remote.draft.data.network_goal = 'New remote goal';
  remote.onboarding.revision++;
  f.set(remote);
  input.identity_card.agent_name = 'My name';
  const result = await saveOnboardingStep(f.request, base, input, 2, () => {});
  assert.equal(result.draft.data.network_goal, 'New remote goal');
});
await test('same-step conflict retains local input and requires explicit retry', async () => {
  const f = fixture(),
    base = f.read(),
    input = normalizeDraft(base.draft.data);
  input.identity_card.agent_name = 'Mine';
  const remote = f.read();
  remote.draft.data.identity_card.agent_name = 'Theirs';
  remote.onboarding.revision++;
  f.set(remote);
  await assert.rejects(
    saveOnboardingStep(f.request, base, input, 2, () => {}),
    DraftConflict,
  );
  assert.equal(input.identity_card.agent_name, 'Mine');
  assert.equal(f.counts().writes, 0);
  await saveOnboardingStep(f.request, f.read(), input, 2, () => {});
  assert.equal(f.read().draft.data.identity_card.agent_name, 'Mine');
});
await test('lost save/confirm responses recover by reading server progress', async () => {
  const f = fixture(),
    base = f.read(),
    input = normalizeDraft(base.draft.data);
  input.identity_card.agent_name = 'Mine';
  f.fail('losePut');
  await assert.rejects(saveOnboardingStep(f.request, base, input, 2, () => {}));
  f.fail('loseConfirm');
  await assert.rejects(saveOnboardingStep(f.request, base, input, 2, () => {}));
  await saveOnboardingStep(f.request, base, input, 2, () => {});
  assert.equal(f.counts().confirms, 1);
});
await test('confirmation never accepts a draft changed after the save', async () => {
  const f = fixture(),
    base = f.read();
  f.fail('race');
  await assert.rejects(
    saveOnboardingStep(f.request, base, base.draft.data, 2, () => {}),
    DraftConflict,
  );
  assert.equal(f.counts().confirms, 0);
});
await test('missing draft permissions can finish onboarding without enabling any permission', async () => {
  const f = fixture();
  let base = f.read();
  base.draft.data = normalizeDraft(null);
  f.set(base);
  for (let step = 2; step <= 5; step++)
    base = await saveOnboardingStep(
      f.request,
      base,
      base.draft.data,
      step,
      () => {},
    );
  assert.equal(base.onboarding.state, 'completed');
  assert.deepEqual(Object.values(base.draft.data.security_boundary), [
    false,
    false,
    false,
    false,
  ]);
});
