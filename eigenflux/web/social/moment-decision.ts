type DecisionBody = {
  action_key: string;
  expected_item_revision: number;
  condition: string;
};

export type DecisionAttempt = {
  signature: string;
  key: string;
  body: DecisionBody & { chat_executor?: string };
};

export function prepareDecision(
  previous: DecisionAttempt | undefined,
  attentionId: string,
  body: DecisionBody,
  executor: string,
): DecisionAttempt {
  const signature = JSON.stringify([attentionId, body]);
  // A timed-out save may already exist. Keep its route and idempotency key
  // even if the chat channel connects or disconnects before the retry.
  if (previous?.signature === signature) return previous;
  return {
    signature,
    key: crypto.randomUUID(),
    body: { ...body, ...(executor ? { chat_executor: executor } : {}) },
  };
}
