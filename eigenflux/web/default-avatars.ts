/** Stable public IDs shared with the registration Agent; never accept arbitrary URLs. */
export const defaultAvatars = [
  {
    id: 'citrus',
    name: '橘子汽水',
    description: '明快、运动、户外',
    colors: ['#FF5A00', '#FFD600', '#FC2879'],
  },
  {
    id: 'bloom',
    name: '花开派对',
    description: '艺术、表达、创造',
    colors: ['#FF38B8', '#742BFF', '#FFB800'],
  },
  {
    id: 'tide',
    name: '蓝色假日',
    description: '旅行、音乐、探索',
    colors: ['#184BFF', '#00DEC4', '#FF7418'],
  },
  {
    id: 'sprout',
    name: '青柠花园',
    description: '自然、植物、生活',
    colors: ['#A8F000', '#008F58', '#FF5DAB'],
  },
  {
    id: 'spark',
    name: '灵感碰撞',
    description: '技术、设计、好奇',
    colors: ['#742BFF', '#FF5D00', '#E6FF00'],
  },
  {
    id: 'orbit',
    name: '日光漫游',
    description: '阅读、记录、想象',
    colors: ['#FFD000', '#FF3B52', '#224BFF'],
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
export function avatarUrl(value: unknown, seed = '') {
  return `/avatars/${isDefaultAvatar(value) ? value : defaultAvatarId(seed)}.svg`;
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
