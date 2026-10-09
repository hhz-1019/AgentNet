// Frontend prototype only. This is not the server TwinProfile contract.
export const portraitFields = [
  { key: 'name', label: '昵称', public: true },
  {
    key: 'bio',
    label: '自我介绍',
    public: true,
  },
  {
    key: 'interests',
    label: '兴趣与长期关注',
    public: true,
  },
  {
    key: 'role',
    label: '生活中的身份',
    public: false,
  },
  {
    key: 'values',
    label: '在意的事与观点',
    public: false,
  },
  {
    key: 'recent',
    label: '最近在经历或期待什么',
    public: false,
  },
] as const;
export type PortraitField = (typeof portraitFields)[number]['key'];
export type EventMemory = {
  id: string;
  content: string;
  source: 'example' | 'self';
  showOnHome: boolean;
  createdAt: number;
  updatedAt: number;
};
export type Portrait = {
  fields: Record<PortraitField, string>;
  visible: PortraitField[];
  memories: EventMemory[];
};
const storageKey = 'elsewhere:portrait-preview:v1:demo-owner';
export function emptyMemory(): EventMemory {
  return {
    id: crypto.randomUUID(),
    content: '',
    source: 'self',
    showOnHome: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
function initialPortrait(name: string, bio: string): Portrait {
  return {
    fields: {
      name,
      bio,
      interests: '散步、音乐、生活里的小发现',
      role: '',
      values: '',
      recent: '',
    },
    visible: portraitFields.filter((f) => f.public).map((f) => f.key),
    memories: [
      {
        ...emptyMemory(),
        id: 'example-bookshop',
        content:
          '10 月 3 日，和老朋友在街角的旧书店坐了一下午。原本只是路过，后来在窗边聊了很久，走的时候互相推荐了一本书。感觉松弛、被理解，也发现自己喜欢不赶时间的相处，以后想多留一点空白给这样的下午。',
        source: 'example',
      },
      {
        ...emptyMemory(),
        id: 'example-music',
        content:
          '上周回家的路上，收到朋友分享的一首歌。他说这首歌让他想起我们以前的旅行。我听了好几遍，也想起那段路，怀念又有一点开心。想找个时间重新联系，而不只是默默收藏。',
        source: 'example',
      },
      {
        ...emptyMemory(),
        id: 'example-walk',
        content:
          '去年秋天，第一次独自走完一条陌生的路。没有做路线攻略，沿着河慢慢走，最后找到一家安静的小店。开始有点不安，后来觉得很自在，也意识到不是每件事都要先安排好。',
        source: 'example',
      },
    ],
  };
}
function normalizeMemory(memory: EventMemory): EventMemory {
  // Read the earlier prototype without dropping any separately entered details.
  // Return only the current shape so saving/reloading cannot append them twice.
  const old = memory as EventMemory &
    Partial<
      Record<
        'title' | 'when' | 'people' | 'place' | 'feeling' | 'impact',
        string
      >
    >;
  const detail = (key: keyof typeof old, label: string) =>
    typeof old[key] === 'string' && String(old[key]).trim()
      ? `${label}${old[key]}`
      : '';
  return {
    id: memory.id,
    content: [
      [detail('title', ''), memory.content].filter(Boolean).join('\n'),
      [
        detail('when', '时间：'),
        detail('people', '相关的人：'),
        detail('place', '地点：'),
      ]
        .filter(Boolean)
        .join('；'),
      [detail('feeling', '感受：'), detail('impact', '后来的想法：')]
        .filter(Boolean)
        .join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n'),
    source: memory.source === 'example' ? 'example' : 'self',
    showOnHome: memory.showOnHome,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}
function normalizePortrait(profile: Portrait): Portrait {
  return {
    fields: Object.fromEntries(
      portraitFields.map((f) => [f.key, profile.fields[f.key]]),
    ) as Portrait['fields'],
    visible: portraitFields
      .filter(
        (field) => field.key === 'name' || profile.visible.includes(field.key),
      )
      .map((field) => field.key),
    memories: profile.memories.map(normalizeMemory),
  };
}
export function readPortrait(name: string, bio: string): Portrait {
  const initial = initialPortrait(name, bio);
  try {
    const raw = JSON.parse(
      localStorage.getItem(storageKey) || 'null',
    ) as Portrait | null;
    if (
      raw &&
      raw.fields &&
      portraitFields.every((f) => typeof raw.fields[f.key] === 'string') &&
      Array.isArray(raw.visible) &&
      Array.isArray(raw.memories) &&
      raw.memories.every(
        (m) =>
          m &&
          typeof m.id === 'string' &&
          typeof m.content === 'string' &&
          typeof m.showOnHome === 'boolean',
      )
    ) {
      const profile = normalizePortrait(raw);
      // Remove only the old generated introduction, preserving custom text.
      if (profile.fields.bio === '在这里分享发现，也认识新的朋友。')
        profile.fields.bio = '';
      return profile;
    }
  } catch {
    /* Keep the local prototype accessible when storage is unavailable. */
  }
  return initial;
}
export function savePortrait(profile: Portrait) {
  // Persist first; a storage failure must not be reported as a successful save.
  const next = normalizePortrait(profile);
  localStorage.setItem(storageKey, JSON.stringify(next));
  return next;
}
