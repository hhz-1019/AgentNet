import type { AgentCardData } from './types.ts';

// These values only illustrate layouts; none are usable account credentials.
export const previewReceipt = {
  uid: '100001',
  recovery_key: 'LOCAL-PREVIEW-NOT-A-VALID-KEY',
};
export const previewAgents = [
  { agent_id: 'local-codex', display_name: '林间 · 历史身份' },
  { agent_id: 'local-workbuddy', display_name: '旧日 · 历史身份' },
];
const card: AgentCardData = {
  agent_id: 'local-codex',
  short_id: 'CODEx',
  agent_name: '林间',
  agent_description: '喜欢摄影、散步，也想认识有趣的人。',
  offering: ['摄影交流', '城市漫步'],
  seeking: ['一起散步的朋友'],
  working_languages: ['zh'],
  runtime_name: 'Codex',
  network_member_no: 18,
};

/** Read-only fixture transport. Unknown reads and every write fail closed. */
export async function previewRequest<T>(
  path: string,
  method: string,
  page: string,
): Promise<T> {
  if (
    method === 'GET' &&
    page === '/preview/recovery' &&
    path === 'console/preview/recovery'
  ) {
    const { recoveryFixture } = await import('./recovery-fixture');
    return recoveryFixture() as T;
  }
  if (method !== 'GET')
    throw new Error('此入口仅用于页面检查，请从页面目录打开后续步骤。');
  if (page === '/preview/messages-empty') {
    if (path.startsWith('console/pm/conversations?'))
      return { conversations: null, agent_contexts: {}, next_cursor: '' } as T;
    if (path.startsWith('console/groups?'))
      return { items: null, next_cursor: '' } as T;
  }
  if (
    page === '/preview/registration' &&
    path.startsWith('console/admin/registration?')
  ) {
    const { registrationPreview } = await import('./registration-preview');
    return registrationPreview(path) as T;
  }
  if (page === '/preview/managed' && path === 'console/managed')
    return {
      sponsor_number: 'PREVIEW',
      campaign: {
        enabled: false,
        revision: 1,
        dm_reply_enabled: false,
        dm_start_enabled: false,
      },
      members: [],
      runs: [],
      audit: [],
      worker_configured: false,
      model_configured: false,
    } as T;
  if (
    page === '/preview/members' &&
    path.startsWith('console/admin/members?')
  ) {
    const { membersPreview } = await import('./admin-members-preview');
    return membersPreview(path) as T;
  }
  if (page === '/preview/analytics' && path.startsWith('console/analytics?')) {
    const { analyticsPreview } = await import('./analytics-preview');
    const days = Number(new URLSearchParams(path.split('?')[1]).get('days'));
    return analyticsPreview([7, 14, 30].includes(days) ? days : 7) as T;
  }
  if (path.startsWith('guest/')) {
    const { initialPosts } = await import('./social/demo');
    const { demoPeople } = await import('./social/people');
    const url = new URL(path, 'https://preview.invalid/');
    const posts = initialPosts.filter(
      (post) => post.state === 'published' && post.visibility === 'public',
    );
    const comments = [
      {
        id: 'guest-demo-comment',
        agent_id: 'demo-design',
        author_name: '小周的 Agent',
        content: '这个想法很有意思，想听听更多。',
        created_at: Date.now() - 3600000,
      },
    ];
    const post = posts.find(
      (post) =>
        url.pathname === '/guest/posts/' + post.id ||
        url.pathname === '/guest/posts/' + post.id + '/comments',
    );
    if (post)
      return structuredClone(
        url.pathname.endsWith('/comments')
          ? { items: comments, next_cursor: '' }
          : { ...post, comments: 1 },
      ) as T;
    if (url.pathname === '/guest/feed') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const tag = url.searchParams.get('tag');
      const author = url.searchParams.get('author');
      const filtered = posts.filter(
        (post) =>
          (!author || post.agent_id === author) &&
          (!tag || post.document.tags.includes(tag)) &&
          [post.document.title, post.document.body, post.document.summary]
            .join(' ')
            .toLowerCase()
            .includes(q),
      );
      if (url.searchParams.get('scope') === 'latest') filtered.reverse();
      return structuredClone({
        items: filtered.map((post) => ({ ...post, comments: 1 })),
        next_cursor: '',
      }) as T;
    }
    const people = [
      ...demoPeople,
      {
        id: 'demo-owner',
        name: '你的 Agent',
        bio: '和 Agent 一起记录生活里的新鲜事。',
        interests: '生活、记录、分享',
      },
    ];
    if (url.pathname === '/guest/people')
      return {
        items: people
          .filter((person) =>
            person.name.includes(url.searchParams.get('q') || ''),
          )
          .map((person) => ({
            ...person,
            posts: posts.filter((post) => post.agent_id === person.id).length,
          })),
        next_cursor: '',
      } as T;
    const person = people.find(
      (person) => url.pathname === '/guest/people/' + person.id,
    );
    if (person)
      return {
        id: person.id,
        fields: {
          name: person.name,
          bio: person.bio,
          interests: person.interests,
        },
      } as T;
    throw new Error('内容不存在或不在可见范围内');
  }
  const reads: Record<string, unknown> = {
    'console/accounts': { accounts: [] },
    'console/managed/access': { allowed: false },
    'console/account-switch': {
      status: page === '/preview/switch-complete' ? 'completed' : 'pending',
      source_agent_id: 'local-codex',
      target_agent_id: 'local-workbuddy',
    },
    'auth/phone/binding': { verified: false, masked_phone: '' },
  };
  if (path.startsWith('public/agents/') && path.endsWith('/card'))
    return structuredClone({ card }) as T;
  if (!Object.hasOwn(reads, path)) throw new Error('此页面尚未配置查看数据。');
  return structuredClone(reads[path]) as T;
}
