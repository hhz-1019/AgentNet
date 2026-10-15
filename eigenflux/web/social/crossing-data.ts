// Fictional, local-only scenarios for the attention design prototype.
export type CrossingStage =
  | 'open'
  | 'pending'
  | 'sent'
  | 'replied'
  | 'observing';
export type CrossingView = 'now' | 'encounters' | 'traces';
export type CrossingDecision = { stage: CrossingStage; condition?: string };
export interface CrossingStory {
  id: string;
  category: string;
  title: string;
  question: string;
  reason: string;
  person: string;
  role: string;
  avatar: string;
  yours: string;
  theirs: string;
  overlap: string;
  description: string;
  evidence: { label: string; text: string; source: string }[];
  uncertainty: string;
  scope: string;
  boundary: string;
  action: string;
  message: string;
  reply: string;
}
export const crossingStories: CrossingStory[] = [
  {
    id: 'zhou',
    category: '首次联系',
    title: '联系一位养老场景研究者',
    question: '要让 Agent 为你们做一次介绍吗？',
    reason: '直接回应你当前的找人目标',
    person: '周宁',
    role: '养老服务研究者',
    avatar: 'sprout',
    yours: '有社会模拟原型，正在寻找真实场景中的验证伙伴。',
    theirs: '有养老服务研究经验，正在寻找能验证互动机制的方法。',
    overlap: '养老场景 × 社会模拟',
    description: '你在寻找真实的问题，她在寻找新的方法。',
    evidence: [
      {
        label: '你的近期目标',
        text: '希望比较主动与被动互动，对老年人孤独感和关系形成的影响。需要一个真实场景来校准模型。',
        source: '你交给 Agent 的目标 · 演示资料',
      },
      {
        label: '对方的公开需求',
        text: '我们在研究养老场景中的日常互动，希望认识做社会模拟的研究者，讨论新的研究方法。',
        source: '周宁的公开研究笔记 · 演示资料',
      },
    ],
    uncertainty: '对方是否能提供场地、是否有合作时间，仍需首次交流确认。',
    scope: '发送一段公开项目简介，询问是否愿意交流。',
    boundary: '不分享原始数据，不替你约时间或承诺合作。',
    action: '允许这次介绍',
    message:
      '你好，周宁。我代表一位正在研究社会模拟的伙伴联系你。他正在探索养老场景的互动机制，读到你的研究需求后，觉得你们可能有共同的问题想解决。愿意先交换一份公开项目简介吗？',
    reply:
      '很愿意了解！我们正好在整理一个互动研究的方向。可以先看看项目简介，再讨论有没有适合的验证场景。',
  },
  {
    id: 'lin',
    category: '方向选择',
    title: '确认下一轮找人的方向',
    question: '先了解把原型变成可用产品的可能性？',
    reason: '需要你校准研究与产品的优先级',
    person: '林予',
    role: '交互设计与前端开发',
    avatar: 'orbit',
    yours: '原型已经能运行，希望让别人更容易理解和使用。',
    theirs: '正在寻找可以共同打磨的 AI 产品，关注人与 Agent 的交互。',
    overlap: '研究原型 × 产品体验',
    description: '一个已经发生的想法，遇到能让它被看见的人。',
    evidence: [
      {
        label: '你的项目进展',
        text: '社会模拟原型已完成第一轮演示，下一阶段需要明确交互与可视化的方向。',
        source: '项目进展摘要 · 演示资料',
      },
      {
        label: '对方的合作意向',
        text: '最近在寻找一个有实际研究基础的 AI 项目，希望参与从原型到体验的过程。',
        source: '林予的公开合作意向 · 演示资料',
      },
    ],
    uncertainty: '目前尚未确认双方投入时间与具体分工。',
    scope: '把产品体验纳入近期找人重点，并询问对方的参与意向。',
    boundary: '不变更项目路线，不承诺合作角色和交付日期。',
    action: '先了解产品合作',
    message:
      '你好，林予。我们有一个正在探索真实场景的社会模拟原型，想了解你对这类 AI 产品交互的兴趣。愿意先交换想法吗？',
    reply: '这个方向很有意思。我想先看看当前原型，再聊聊可以一起做什么。',
  },
  {
    id: 'chen',
    category: '资料交接',
    title: '整理收到的关系演化研究说明',
    question: '是否让 Agent 整理其中值得继续聊的问题？',
    reason: '对方已提供资料，需要你决定下一步',
    person: '陈屿',
    role: '多智能体系统研究者',
    avatar: 'tide',
    yours: '想了解关系如何从多次互动中产生。',
    theirs: '整理了一份 Agent 关系演化的研究说明，希望交换反馈。',
    overlap: '关系演化 × 多智能体',
    description: '已经交换的想法，可以再向前走一步。',
    evidence: [
      {
        label: '当前关注的问题',
        text: '除了互动次数，还希望观察关系稳定性、互惠行为和长期变化。',
        source: '你的研究关注 · 演示资料',
      },
      {
        label: '收到的研究说明',
        text: '这份说明讨论了重复互动、互惠机制与关系演化，并列出了三个可能继续研究的问题。',
        source: '陈屿分享的研究摘要 · 演示资料',
      },
    ],
    uncertainty: '说明中的实验结果尚未复核；目前只作为讨论材料。',
    scope: '阅读这份已分享的说明，整理交流提纲。',
    boundary: '只生成供你查看的提纲，不自动发出反馈。',
    action: '整理交流提纲',
    message:
      '交流提纲：1. 关系稳定性如何定义？2. 如何分离互动次数与互惠机制的影响？3. 有没有可用于交叉验证的场景？',
    reply: '提纲已经准备好。你可以带着这三个问题，继续与陈屿交流。',
  },
];
export const crossingStageLabel: Record<CrossingStage, string> = {
  open: '等待你的判断',
  pending: '已决定 · 等待执行',
  sent: 'Agent 已执行',
  replied: '新的进展',
  observing: '先观察',
};
