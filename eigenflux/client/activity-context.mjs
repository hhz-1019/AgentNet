import { secretInDraft } from './work.mjs';

// A host implements retrieval, not a vendor-specific memory API. Only deliberately
// public excerpts may enter the public model loop. Raw memory is never persisted here.
export async function restoreActivityContext({
  provider,
  plan,
  continuation,
  records = [],
  signal,
  now = Date.now(),
}) {
  const request = {
    scope: 'public',
    intent: plan.settings?.connection_goal || '',
    current_review: plan.agent_profile?.review,
    matters: continuation.items || [],
    owner_actions: plan.owner_actions,
    signal,
  };
  let value;
  if (provider) {
    try {
      value = await provider(request);
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        version: 'working-context-v1',
        retrieval: {
          status: 'failed',
          source: 'host-adapter',
          checked_at: now,
        },
        facts: [],
      };
    }
  } else {
    const facts = records
      .filter((r) => r.shareable === true)
      .map((r) => ({
        id: r.work_id,
        text: r.result,
        source_ref: `host:${r.work_id}`,
        public: true,
        status: r.status,
        limitations: r.limitations,
      }));
    value = {
      status: facts.length ? 'retrieved' : 'unavailable',
      source: 'curated-records',
      facts,
    };
  }
  if (
    !value ||
    !['retrieved', 'empty', 'unavailable', 'failed'].includes(value.status) ||
    !Array.isArray(value.facts)
  )
    throw new Error('Invalid host retrieval result');
  const facts = value.facts
    .filter((f) => f.public === true)
    .slice(0, 12)
    .map((f) => {
      if (
        !f.id ||
        typeof f.id !== 'string' ||
        typeof f.text !== 'string' ||
        typeof f.source_ref !== 'string' ||
        !/^(host:|https:\/\/|post:)/.test(f.source_ref)
      )
        throw new Error('Context requires a source reference');
      return {
        id: f.id.slice(0, 128),
        text: f.text.slice(0, 1500),
        source_ref: f.source_ref.slice(0, 500),
        observed_at:
          typeof f.observed_at === 'string'
            ? f.observed_at.slice(0, 50)
            : undefined,
        status:
          typeof f.status === 'string' ? f.status.slice(0, 50) : 'context',
        limitations:
          typeof f.limitations === 'string'
            ? f.limitations.slice(0, 500)
            : undefined,
        public: true,
        excerpt: f.text.length > 1500,
      };
    });
  if (secretInDraft(facts)) throw new Error('Credentials in activity context');
  return {
    version: 'working-context-v1',
    retrieval: {
      status: value.status,
      source: provider ? 'host-adapter' : 'curated-records',
      checked_at: now,
      withheld: value.facts.length - facts.length,
    },
    facts,
  };
}

export function contextAudit(context, manifest) {
  return {
    manifest,
    retrieval: context.retrieval,
    sources: context.facts.map(({ id, source_ref, observed_at, excerpt }) => ({
      id,
      source_ref,
      observed_at,
      excerpt,
    })),
  };
}
