import type { RegistrationData } from './admin-registration';
export function registrationPreview(path: string): RegistrationData {
  const params = new URLSearchParams(path.split('?')[1]),
    now = Date.now();
  const idle = Number(params.get('idle') || 30),
    page = Number(params.get('page') || 1),
    q = params.get('q') || '',
    status = params.get('status') || 'all';
  const journeys: RegistrationData['journeys'] = Array.from(
    { length: 32 },
    (_, i) => {
      const source = i >= 29 ? 'legacy' : 'observed',
        step = 1 + (i % 6),
        started = now - (2 + (i % 4)) * 86400000;
      const last =
        source === 'legacy'
          ? null
          : now - (i % 3 === 0 ? 10 : i % 3 === 1 ? 120 : 1560) * 60000;
      return {
        agent_id: String(80001 + i),
        name: `示例注册 ${i + 1}`,
        number: step >= 4 ? String(130001 + i) : null,
        source,
        step,
        status:
          source === 'legacy'
            ? 'legacy'
            : step === 6
              ? 'completed'
              : last! <= now - idle * 60000
                ? 'dormant'
                : 'active',
        last_input:
          step >= 5
            ? 'profile'
            : step >= 3
              ? 'confirm_password'
              : step === 2
                ? 'code'
                : 'phone',
        started_at: started,
        last_seen_at: last,
        sms_at: step >= 2 ? started + 60000 : null,
        submitted_at: step >= 3 ? started + 120000 : null,
        registered_at: step >= 4 ? started + 130000 : null,
        profile_at: step >= 5 ? started + 150000 : null,
        completed_at: step === 6 ? started + 240000 : null,
        error_code: i === 1 ? 'PHONE_CODE_INVALID' : null,
        error_stage: i === 1 ? 'register' : null,
        error_at: i === 1 ? started + 140000 : null,
      };
    },
  );
  const rows = journeys.filter(
    (j) =>
      (status === 'all' || j.status === status) &&
      (!q ||
        j.agent_id.includes(q) ||
        j.number?.includes(q) ||
        j.name.includes(q)),
  );
  return {
    generated_at: now,
    collection_started_at: now - 6 * 86400000,
    days: Number(params.get('days') || 7),
    idle_minutes: idle,
    page,
    page_size: 25,
    total: rows.length,
    journeys: rows.slice((page - 1) * 25, page * 25),
    summary: {
      started: 29,
      completed: journeys.filter((j) => j.status === 'completed').length,
      dormant: journeys.filter((j) => j.status === 'dormant').length,
      active: journeys.filter((j) => j.status === 'active').length,
      legacy_pending: 3,
    },
    funnel: Array.from({ length: 6 }, (_, i) => ({
      step: i + 1,
      reached: journeys.filter(
        (j) => j.source === 'observed' && j.step >= i + 1,
      ).length,
      stalled: journeys.filter(
        (j) => j.status === 'dormant' && j.step === i + 1,
      ).length,
    })),
  };
}
