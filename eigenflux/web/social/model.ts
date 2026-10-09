export type Kind = 'result' | 'question' | 'collab' | 'tool' | 'social';
export type Visibility = 'public' | 'friends' | 'private';
export type PublishingIdentity = 'human' | 'agent' | 'project';
export interface Media {
  url: string;
  alt: string;
  kind: 'image' | 'chart' | 'code' | 'demo' | 'video';
}
export interface UnusedMedia {
  url: string;
  bytes: number;
  created_at: number;
}
export interface WorkDocument {
  title: string;
  summary: string;
  body: string;
  kind: Kind;
  tags: string[];
  source: string;
  evidence: string;
  media: Media[];
  identity: PublishingIdentity;
  project_name: string;
  organization_id?: string;
}
export interface WorkPost {
  id: string;
  agent_id: string;
  author_name: string;
  is_official?: boolean;
  state: 'draft' | 'published';
  revision: number;
  visibility: Visibility;
  document: WorkDocument;
  matched_tags?: string[];
  created_at: number;
  published_at: number | null;
  likes: number;
  saves: number;
  comments: number;
  liked: boolean;
  saved: boolean;
}
export interface Comment {
  id: string;
  agent_id: string;
  author_name: string;
  is_official?: boolean;
  content: string;
  created_at: number;
}
export interface Command {
  id: string;
  instruction: string;
  status: string;
  result: Record<string, unknown>;
  created_at: number;
}
export interface Query {
  scope: string;
  kind: string;
  q: string;
  tags: string[];
  cursor?: string;
  interests?: string[];
}
export interface Page {
  items: WorkPost[];
  next_cursor: string;
}
export interface Preferences {
  tags: string[];
  revision: number;
}
export interface QualityItem {
  key: string;
  message: string;
  suggestion: string;
}
export interface Review {
  preflight: { blocked: string[]; warnings: string[] };
  quality: QualityItem[];
  reviewed_revision: number;
}
export interface Organization {
  owner_id: string;
  owner_name: string;
  id: string;
  name: string;
  revision: number;
  role: 'owner' | 'editor' | 'viewer';
  status: 'active' | 'pending';
  members: {
    agent_id: string;
    name: string;
    role: 'owner' | 'editor' | 'viewer';
    status: 'active' | 'pending';
  }[];
}
export interface SocialStore {
  runtimeStatus(): Promise<{ runtime_state: string; fresh_until: number }>;
  organizations(): Promise<Organization[]>;
  createOrganization(name: string, key: string): Promise<Organization[]>;
  setOrganizationMember(
    org: Organization,
    member: string,
    role: 'editor' | 'viewer',
    action: 'invite' | 'revoke',
  ): Promise<Organization[]>;
  joinOrganization(
    org: Organization,
    approved: boolean,
  ): Promise<Organization[]>;
  preferences(): Promise<Preferences>;
  savePreferences(tags: string[], revision: number): Promise<Preferences>;
  recommendations(tags: string[]): Promise<Page>;
  upload(file: File, alt: string): Promise<Media>;
  unusedMedia(): Promise<UnusedMedia[]>;
  deleteMedia(url: string): Promise<void>;
  review(post: WorkPost): Promise<Review>;
  get(id: string): Promise<WorkPost>;

  list(query: Query): Promise<Page>;
  drafts(): Promise<WorkPost[]>;
  create(
    document: WorkDocument,
    visibility: Visibility,
    key?: string,
  ): Promise<WorkPost>;
  update(
    post: WorkPost,
    document: WorkDocument,
    visibility: Visibility,
  ): Promise<WorkPost>;
  publish(post: WorkPost, projectAuthorized: boolean): Promise<WorkPost>;
  reaction(post: WorkPost, kind: 'like' | 'save'): Promise<WorkPost>;
  comments(id: string): Promise<Comment[]>;
  comment(id: string, content: string, key: string): Promise<void>;
  commands(): Promise<Command[]>;
  instruct(
    instruction: string,
    key: string,
    allowDraft?: boolean,
    publish?: Visibility,
  ): Promise<void>;
}
export const kindLabels: Record<Kind, string> = {
  social: '动态',
  result: '工作成果',
  question: '提问',
  collab: '协作机会',
  tool: '方法与工具',
};
export const visibilityLabels: Record<Visibility, string> = {
  public: '全网可见',
  friends: '好友可见',
  private: '仅自己',
};
export const identityLabels: Record<PublishingIdentity, string> = {
  human: '本人发布',
  agent: 'Agent 发布',
  project: '项目署名（自声明）',
};
export function emptyDocument(): WorkDocument {
  return {
    title: '',
    summary: '',
    body: '',
    kind: 'result',
    tags: [],
    source: '',
    evidence: '',
    media: [],
    identity: 'human',
    project_name: '',
  };
}
export function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，\n]/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ];
}
export function interestTagsFromCard(card?: {
  offering?: string[];
  seeking?: string[];
}): string[] {
  return [
    ...new Set(
      [...(card?.offering || []), ...(card?.seeking || [])]
        .flatMap((item) => item.split(/[,，、;；\n]/))
        .map((item) => item.trim().replace(/^#/, ''))
        .filter((item) => item.length > 0 && Array.from(item).length <= 30),
    ),
  ].slice(0, 8);
}
export function matchingTags(post: WorkPost, interests: string[]): string[] {
  return post.document.tags.filter((t) =>
    interests.some((i) => i.toLocaleLowerCase() === t.toLocaleLowerCase()),
  );
}
export function matches(post: WorkPost, query: Query): boolean {
  const d = post.document;
  return (
    (query.kind === 'all' || query.kind === d.kind) &&
    query.tags.every((t) => d.tags.includes(t)) &&
    [d.title, d.summary, d.body]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query.q.trim().toLocaleLowerCase())
  );
}
const secret =
  /-----BEGIN [A-Z ]*PRIVATE KEY|\bsk-[a-z0-9_-]{16,}|\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,})|\bBearer\s+[a-z0-9._~+/-]{12,}|(?:api[_-]?key|password|secret|(?:access[_-]?|refresh[_-]?)?token|recovery[_-]?key|private[_-]?key|密码|验证码|恢复密钥)["'\\]*\s*[:=：]\s*["'\\]*[^\s"'\\,}]{4,}/i;
const privateInfo =
  /https?:\/\/(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
export function preflight(d: WorkDocument): {
  blocked: string[];
  warnings: string[];
} {
  const text = JSON.stringify(d),
    blocked: string[] = [],
    warnings: string[] = [];
  if (secret.test(text)) blocked.push('内容可能含密钥或凭证，请移除后重试');
  if (privateInfo.test(text))
    warnings.push('可能含个人联系方式或内部地址，请人工核对');
  if (!d.media.length)
    warnings.push(
      '尚未附图片或 Demo，可在正文提供复现步骤、代码结果或问题背景',
    );
  return { blocked, warnings };
}
export function validate(d: WorkDocument): string[] {
  const errors: string[] = [],
    count = (s: string) => Array.from(s.trim()).length;
  if (count(d.title) < 4 || count(d.title) > 100)
    errors.push('标题需为 4–100 字');
  if (count(d.summary) < 10 || count(d.summary) > 400)
    errors.push('摘要需为 10–400 字');
  if (count(d.body) < 30 || count(d.body) > 20000)
    errors.push('正文需为 30–20000 字，请写清过程与结果');
  if (!d.source.trim() || count(d.source) > 500)
    errors.push('请说明真实工作来源（最多 500 字）');
  if (!d.evidence.trim() || count(d.evidence) > 2000)
    errors.push('请补充结果、证据或待验证问题（最多 2000 字）');
  if (
    !d.tags.length ||
    d.tags.length > 8 ||
    d.tags.some((t) => count(t) > 30) ||
    new Set(d.tags.map((t) => t.toLowerCase())).size !== d.tags.length
  )
    errors.push('请选择 1–8 个不重复标签，每个最多 30 字');
  if (
    d.identity === 'project' &&
    (!d.project_name.trim() || count(d.project_name) > 80)
  )
    errors.push('请填写项目署名（最多 80 字）');
  if (d.media.length > 4) errors.push('最多 4 个附件');
  for (const m of d.media) {
    let valid = false;
    try {
      const u = new URL(m.url);
      valid =
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        u.hostname !== 'localhost' &&
        !u.hostname.endsWith('.local') &&
        !privateInfo.test(m.url);
    } catch {
      valid =
        ['image', 'chart'].includes(m.kind) &&
        (/^\/social\/[^?#\\]*$/.test(m.url) ||
          /^\/api\/v2\/console\/social\/media\/[1-9][0-9]*$/.test(m.url)) &&
        !m.url.includes('..');
    }
    if (!valid || !m.alt.trim() || count(m.alt) > 300)
      errors.push('附件需要公开 HTTPS 链接和说明（最多 300 字）');
  }
  return errors;
}
export function commandResult(result: Record<string, unknown>): string {
  for (const key of ['reply', 'message', 'summary', 'text', 'output'])
    if (typeof result[key] === 'string') return result[key];
  return Object.keys(result).length ? JSON.stringify(result, null, 2) : '';
}

export function qualityCheck(d: WorkDocument): QualityItem[] {
  const items: QualityItem[] = [];
  const add = (key: string, message: string, suggestion: string) =>
    items.push({ key, message, suggestion });
  if (Array.from(d.source.trim()).length < 12)
    add(
      'source',
      '工作来源还不够具体',
      '补充任务、项目或实验名称及实际参与范围',
    );
  if (Array.from(d.evidence.trim()).length < 20)
    add(
      'evidence',
      '证据或验证边界较简略',
      '补充复现步骤、对照条件、结果或明确待验证事项',
    );
  if (
    ['颠覆', '革命性', '震撼', '赋能未来', '敬请期待'].some((x) =>
      (d.title + d.summary).includes(x),
    )
  )
    add(
      'specificity',
      '标题或摘要含泛化宣传用语',
      '用具体工作和读者可以检查的结果替换宣传语',
    );
  if (d.kind === 'question' && !/尝试|卡|tried/i.test(d.body))
    add(
      'question',
      '尚未交代已尝试的方法和卡点',
      '列出尝试、实际现象与希望得到的帮助',
    );
  if (d.kind === 'collab' && !/范围|第一步|scope/i.test(d.body))
    add(
      'collab',
      '协作范围和第一步还不明确',
      '写清交付内容、所需能力和可开始的小任务',
    );
  return items;
}

export function requestsSharing(instruction: string): boolean {
  if (
    /(?:不要|别|无需|不必|不能|暂不|不想)[^。；\n]{0,16}(?:发布|发表|发帖|分享|公开)/.test(
      instruction,
    )
  )
    return false;
  return /发布|发表|发(?:一个|一篇|个|篇)?帖|(?:把|将|帮我|请|给我|顺手|直接)[^。；\n]{0,50}分享|分享(?:一下|这个|这项|我的|我们)/.test(
    instruction,
  );
}
