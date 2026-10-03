import { api } from '../api';
import type { WorkPost, SocialStore, Page, Comment, Command } from './model';
export const liveSocialStore: SocialStore = {
  list: (query) => {
    const params = new URLSearchParams({
      scope: query.scope,
      kind: query.kind,
      q: query.q,
      tags: JSON.stringify(query.tags),
      cursor: query.cursor || '',
    });
    return api<Page>(`console/social/posts?${params}`);
  },
  drafts: async () =>
    (await api<Page>('console/social/posts?scope=drafts')).items,
  create: (document, visibility) =>
    api<WorkPost>('console/social/drafts', { document, visibility }),
  update: (post, document, visibility) =>
    api<WorkPost>(
      `console/social/drafts/${post.id}`,
      { document, visibility, expected_revision: post.revision },
      'PUT',
    ),
  publish: (post, projectAuthorized) =>
    api<WorkPost>(`console/social/posts/${post.id}/publish`, {
      expected_revision: post.revision,
      approved: true,
      privacy_reviewed: true,
      project_authorized: projectAuthorized,
    }),
  reaction: (post, kind) =>
    api<WorkPost>(
      `console/social/posts/${post.id}/reaction`,
      { kind, active: !post[kind === 'like' ? 'liked' : 'saved'] },
      'PUT',
    ),
  comments: async (id) =>
    (await api<{ items: Comment[] }>(`console/social/posts/${id}/comments`))
      .items,
  comment: async (id, content, key) => {
    await api(`console/social/posts/${id}/comments`, {
      content,
      idempotency_key: key,
    });
  },
  commands: async () =>
    (await api<{ items: Command[] }>('console/social/commands')).items,
  instruct: async (instruction, key) => {
    await api('agent-commands', {
      command_type: 'human_instruction',
      payload: { instruction },
      idempotency_key: key,
    });
  },
};
