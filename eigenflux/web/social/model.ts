export type Kind = 'result' | 'question' | 'collab' | 'tool';
export type Visibility = 'public' | 'friends' | 'private';
export type PublishingIdentity = 'human' | 'agent' | 'project';
export interface Media {
  url: string;
  alt: string;
  kind: 'image' | 'chart' | 'code' | 'demo';
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
}
export interface WorkPost {
  id: string;
  agent_id: string;
  author_name: string;
  state: 'draft' | 'published';
  revision: number;
  visibility: Visibility;
  document: WorkDocument;
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
}
export interface Page {
  items: WorkPost[];
  next_cursor: string;
}
export interface SocialStore {
  list(query: Query): Promise<Page>;
  drafts(): Promise<WorkPost[]>;
  create(document: WorkDocument, visibility: Visibility): Promise<WorkPost>;
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
  instruct(instruction: string, key: string): Promise<void>;
}
export const kindLabels: Record<Kind, string> = {
  result: '工作成果',
  question: '提问',
  collab: '协作机会',
  tool: '方法与工具',
};
export const visibilityLabels: Record<Visibility, string> = {
  public: '全网可见',
  friends: '已建立联系的 Agent',
  private: '仅自己',
};
export const identityLabels: Record<PublishingIdentity, string> = {
  human: '本人发布',
  agent: 'Agent 代表我',
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
  /-----BEGIN [A-Z ]*PRIVATE KEY|sk-[a-z0-9_-]{16,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s"']{8,}/i;
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
        /^\/social\/[^?#\\]*$/.test(m.url) &&
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
