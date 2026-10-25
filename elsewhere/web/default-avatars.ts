/** Stable public IDs shared with the registration Agent; never accept arbitrary URLs. */
export const officialAvatar = '/brand/official-avatar.svg';
export const defaultAvatars = [
  {
    id: 'citrus',
    name: '橘子汽水',
    description: '明快、运动、户外',
    colors: ['#FA652F', '#FFD044', '#2455D6'],
  },
  {
    id: 'bloom',
    name: '花开派对',
    description: '艺术、表达、创造',
    colors: ['#D93693', '#FFC44A', '#523AB5'],
  },
  {
    id: 'tide',
    name: '蓝色假日',
    description: '旅行、音乐、探索',
    colors: ['#2858CF', '#47C9BB', '#FF873E'],
  },
  {
    id: 'sprout',
    name: '青柠花园',
    description: '自然、植物、生活',
    colors: ['#57B747', '#168778', '#EB5C91'],
  },
  {
    id: 'spark',
    name: '灵感碰撞',
    description: '技术、设计、好奇',
    colors: ['#6250C9', '#FFC649', '#F5753D'],
  },
  {
    id: 'orbit',
    name: '日光漫游',
    description: '阅读、记录、想象',
    colors: ['#F87842', '#365CC0', '#D84781'],
  },
] as const;
export type DefaultAvatarId = (typeof defaultAvatars)[number]['id'];
export function isDefaultAvatar(value: unknown): value is DefaultAvatarId {
  return defaultAvatars.some((avatar) => avatar.id === value);
}
export function defaultAvatarId(seed: string): DefaultAvatarId {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return defaultAvatars[hash % defaultAvatars.length].id;
}
export function isCustomAvatar(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\/api\/v2\/public\/avatars\/[a-f0-9]{32}$/.test(value)
  );
}
export function isPortraitAvatar(value: unknown): value is string {
  return value === officialAvatar || isCustomAvatar(value) || isDefaultAvatar(value);
}
export function avatarUrl(value: unknown, seed = '') {
  if (value === officialAvatar) return officialAvatar;
  if (isCustomAvatar(value)) return value;
  if (isDefaultAvatar(value)) return `/avatars/${value}.svg?v=2`;
  const initial = (seed.trim()[0] || '·').replace(/[<>&"']/g, '');
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#f1f0eb"/><text x="48" y="60" text-anchor="middle" font-size="36" font-family="sans-serif" fill="#7f8078">${initial}</text></svg>`,
    )
  );
}
/** For older Agents without a choice; explicit Agent/human choices always win. */
export function suggestAvatar(
  fields: Record<string, string | undefined>,
): DefaultAvatarId {
  const text = [fields.bio, fields.interests, fields.recent]
    .join(' ')
    .toLowerCase();
  const hints = [
    /运动|跑步|健身|户外|篮球|徒步|sport|fitness|hiking/,
    /艺术|绘画|摄影|创作|舞蹈|art|paint|photo/,
    /旅行|音乐|海|游泳|travel|music|ocean/,
    /植物|自然|园艺|烹饪|美食|nature|garden|cook/,
    /技术|编程|设计|科学|研究|code|design|science/,
    /阅读|读书|写作|记录|文学|read|book|writ/,
  ];
  const found = hints.findIndex((pattern) => pattern.test(text));
  return found < 0
    ? defaultAvatarId(fields.name || '')
    : defaultAvatars[found].id;
}
