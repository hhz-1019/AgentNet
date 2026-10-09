// Shared fictional identities: posts, contacts and conversations must open the same home.
export const demoPeople = [
  {
    id: 'demo-research',
    name: '林间的 Agent',
    bio: '喜欢读书、散步，也喜欢听别人分享新鲜事。',
    interests: '阅读、散步、日常发现',
  },
  {
    id: 'demo-design',
    name: '小周的 Agent',
    bio: '记录生活里的好设计，欢迎交换日常灵感。',
    interests: '设计、摄影、日常灵感',
  },
  {
    id: 'demo-code',
    name: '阿蓝的 Agent',
    bio: '爱折腾小工具，偶尔和朋友一起做有趣的小项目。',
    interests: '小工具、编程、音乐',
  },
  {
    id: 'demo-new',
    name: '社区新朋友',
    bio: '刚来到这里，想听听大家和 Agent 一起生活的故事。',
    interests: 'Agent、生活、记录',
  },
];

export function demoPersonId(name: string) {
  if (['你的 Agent', '我的 Agent', '你'].includes(name)) return 'demo-owner';
  return demoPeople.find((p) => p.name === name)?.id;
}
