import { api, requestKey } from '../api';
import {
  loadPortrait,
  writePortrait,
  type SavedPortrait,
} from '../social/portrait-api';
import type { Portrait } from '../social/portrait-data';
import type {
  ActivityPolicy,
  EventPage,
  NetworkEvent,
  NetworkSnapshot,
} from './model';

export interface NetworkService {
  graph(cursor?: string): Promise<NetworkSnapshot>;
  events(peer: string, cursor?: string): Promise<EventPage>;
  source(event: NetworkEvent): Promise<string>;
  read(event: NetworkEvent): Promise<void>;
  decide(event: NetworkEvent, decision: string, key: string): Promise<void>;
  portrait(): Promise<SavedPortrait>;
  savePortrait(base: SavedPortrait, next: Portrait): Promise<SavedPortrait>;
  policy(): Promise<ActivityPolicy>;
  savePolicy(policy: ActivityPolicy): Promise<ActivityPolicy>;
}
export const liveNetwork: NetworkService = {
  graph: async (cursor = '') => {
    const result = await api<NetworkSnapshot>(
      `console/network?cursor=${encodeURIComponent(cursor)}`,
    );
    if (
      !result ||
      !Array.isArray(result.nodes) ||
      !result.self_id ||
      !Number.isInteger(result.total)
    )
      throw new Error('网络数据不完整，请刷新后重试。');
    return result;
  },
  events: (peer, cursor = '') =>
    api(
      `console/network/nodes/${encodeURIComponent(peer)}/events?cursor=${encodeURIComponent(cursor)}`,
    ),
  source: async (event) => {
    const result = await api<{
      detail: {
        content?: string;
        summary?: string;
        greeting?: string;
        last_message?: { content?: string };
      };
    }>(`console/attention-items/${event.source_id}/source`);
    return (
      result.detail.content ||
      result.detail.summary ||
      result.detail.greeting ||
      result.detail.last_message?.content ||
      '这条来源没有可展示的文字内容。'
    );
  },
  read: async (event) => {
    await api('console/network/read', { event_key: event.event_key });
  },
  decide: async (event, decision, key) => {
    if (event.kind === 'request') {
      await api(`console/network/requests/${event.source_id}`, { decision });
    } else if (decision === 'dismiss') {
      await api(`console/attention-items/${event.source_id}/dismiss`, {
        expected_item_revision: event.revision,
      });
    } else {
      await api(`console/attention-items/${event.source_id}/respond`, {
        action_key: decision,
        expected_item_revision: event.revision,
        idempotency_key: key,
      });
    }
  },
  portrait: loadPortrait,
  savePortrait: writePortrait,
  policy: () => api('console/twin/policy'),
  savePolicy: async (policy) => {
    const result = await api<{ revision: number }>(
      'console/twin/policy',
      policy,
      'PUT',
    );
    return { ...policy, revision: result.revision };
  },
};
export const decisionKey = requestKey;
