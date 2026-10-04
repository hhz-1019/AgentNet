import { api } from '../api';
import type {
  WorkPost,
  SocialStore,
  Page,
  Comment,
  Command,
  Preferences,
  Review,
  Media,
  UnusedMedia,
  Organization,
} from './model';
export const liveSocialStore: SocialStore = {
  runtimeStatus: () => api('console/today/status'),
  organizations: async () =>
    (await api<{ items: Organization[] }>('console/social/organizations'))
      .items,
  createOrganization: async (name, idempotency_key) =>
    (
      await api<{ items: Organization[] }>('console/social/organizations', {
        name,
        idempotency_key,
      })
    ).items,
  setOrganizationMember: async (org, member, role, action) =>
    (
      await api<{ items: Organization[] }>(
        `console/social/organizations/${org.id}/members/${member}`,
        { role, action, expected_revision: org.revision },
        'PUT',
      )
    ).items,
  joinOrganization: async (org, approved) =>
    (
      await api<{ items: Organization[] }>(
        `console/social/organizations/${org.id}/join`,
        { approved, expected_revision: org.revision },
      )
    ).items,
  preferences: () => api<Preferences>('console/social/preferences'),
  savePreferences: (tags, expected_revision) =>
    api<Preferences>(
      'console/social/preferences',
      { tags, expected_revision },
      'PUT',
    ),
  recommendations: (tags) =>
    api<Page>(
      `console/social/recommendations?tags=${encodeURIComponent(JSON.stringify(tags))}`,
    ),
  review: (post) => api<Review>(`console/social/posts/${post.id}`),
  get: async (id) =>
    (await api<{ post: WorkPost }>(`console/social/posts/${id}`)).post,
  upload: async (file, alt) => {
    if (
      !['image/png', 'image/jpeg'].includes(file.type) ||
      file.size > 512 * 1024
    )
      throw new Error('请选择不超过 512 KB 的 PNG/JPEG 图片');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string')
          resolve(reader.result.split(',')[1]);
        else reject(new Error('无法读取这张图片'));
      };
      reader.onerror = () => reject(new Error('无法读取这张图片'));
      reader.readAsDataURL(file);
    });
    return api<Media>('console/social/media', { data, alt, kind: 'image' });
  },
  unusedMedia: async () =>
    (await api<{ items: UnusedMedia[] }>('console/social/media')).items,
  deleteMedia: async (url) => {
    if (!/^\/api\/v2\/console\/social\/media\/[1-9]\d*$/.test(url))
      throw new Error('图片地址无效');
    await api(
      `console/social/media/${url.split('/').at(-1)}`,
      undefined,
      'DELETE',
    );
  },
  list: (query) => {
    const params = new URLSearchParams({
      scope: query.scope,
      kind: query.kind,
      q: query.q,
      tags: JSON.stringify(query.tags),
      cursor: query.cursor || '',
      interests: JSON.stringify(query.interests || []),
    });
    return api<Page>(`console/social/posts?${params}`);
  },
  drafts: async () =>
    (await api<Page>('console/social/posts?scope=drafts')).items,
  create: (document, visibility, key) =>
    api<WorkPost>('console/social/drafts', {
      document,
      visibility,
      idempotency_key: key,
    }),
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
  instruct: async (instruction, key, allowDraft = false, publish) => {
    await api('agent-commands', {
      command_type: 'human_instruction',
      payload: {
        instruction,
        allow_draft: allowDraft,
        publish: !!publish,
        visibility: publish,
      },
      idempotency_key: key,
    });
  },
};
