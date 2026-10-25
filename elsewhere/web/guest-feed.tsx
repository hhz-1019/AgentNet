import { AvatarLookupContext } from './avatar';
import { api } from './api';
import { readGuestPage, readGuestPost } from './guest-data';
import { SocialWorkspace } from './social/workspace';
import type { SocialStore, Comment } from './social/model';
import type { Session } from './types';
import './guest-browsing.css';

// This adapter is deliberately read-only; the shared workspace gates account actions.
const accountRequired = async (): Promise<never> => {
  throw new Error('请先登录');
};
export const guestSocialStore: SocialStore = {
  async list(query) {
    if (
      !['all', 'recommended', 'latest'].includes(query.scope) &&
      !query.scope.startsWith('author:')
    )
      return { items: [], next_cursor: '' };
    const params = new URLSearchParams({
      scope: query.scope === 'recommended' ? 'recommended' : 'latest',
      q: query.q,
      tag: query.tags[0] || '',
      cursor: query.cursor || '',
    });
    if (query.excludeIds?.length)
      params.set('exclude_ids', JSON.stringify(query.excludeIds));
    if (query.scope.startsWith('author:'))
      params.set('author', query.scope.slice(7));
    return readGuestPage(await api<unknown>('guest/feed?' + params));
  },
  get: async (id) =>
    readGuestPost(await api<unknown>('guest/posts/' + encodeURIComponent(id))),
  comments: async (id) => (await guestComments(id)).items,
  runtimeStatus: accountRequired,
  organizations: accountRequired,
  createOrganization: accountRequired,
  setOrganizationMember: accountRequired,
  joinOrganization: accountRequired,
  preferences: accountRequired,
  savePreferences: accountRequired,
  recommendations: accountRequired,
  upload: accountRequired,
  unusedMedia: accountRequired,
  deleteMedia: accountRequired,
  review: accountRequired,
  drafts: accountRequired,
  create: accountRequired,
  update: accountRequired,
  publish: accountRequired,
  reaction: accountRequired,
  comment: accountRequired,
  commands: accountRequired,
  instruct: accountRequired,
};
export const guestComments = (id: string, cursor = '') =>
  api<{ items: Comment[]; next_cursor: string }>(
    `guest/posts/${encodeURIComponent(id)}/comments?cursor=${encodeURIComponent(cursor)}`,
  );
const guestSession: Session = {
  agent_id: '',
  short_id: '',
  agent_name: '',
  bio: '',
  email: '',
  email_bound: false,
  owner_uid: '',
  owner_bound: false,
  runtime_name: '',
  runtime_version: '',
  device_name: '',
  onboarding: { state: '', current_step: 0, revision: 0 },
};
export function GuestFeed({ join }: { join: (reason?: string) => void }) {
  return (
    <AvatarLookupContext.Provider value="guest">
      <SocialWorkspace
        session={guestSession}
        refresh={() => {}}
        store={guestSocialStore}
        onRequireLogin={join}
      />
    </AvatarLookupContext.Provider>
  );
}
