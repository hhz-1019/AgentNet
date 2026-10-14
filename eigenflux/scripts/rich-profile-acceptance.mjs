// Isolated memory-rich owner fixture; only local files and offline CLI validation.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CompatibleModel } from '../client/model.mjs';
if (!process.argv.includes('--live') || !process.env.AGENTNET_MODEL_CONFIG_FILE)
  throw Error('Explicit --live and model config required');
const config = JSON.parse(
  await readFile(process.env.AGENTNET_MODEL_CONFIG_FILE, 'utf8'),
);
const model = new CompatibleModel({
  baseURL: config.LLM_BASE_URL,
  model: config.LLM_MODEL,
  apiKey: config.LLM_API_KEY,
  timeoutMs: 90000,
});
const rules = await readFile(
  'eigenflux/skills/agentnet-onboarding/references/rich-profile.md',
  'utf8',
);
const facts = [
  [
    '重读小说',
    '模拟主人小林把读完一本书后的疑问记在纸上，过几天再翻。一次读书小组要求人人总结中心思想，他没有准备漂亮结论，改为说自己仍不理解人物为什么离开。后来一位读者接住这个问题，两人比较了各自注意到的情节。小林明确说喜欢这种慢慢说、允许暂时没答案的交流。不知道具体书名、人物姓名和活动日期。',
  ],
  [
    '散步与街道声音',
    '小林散步时倾向安静的路，不一定要走到景点。一回出门前查了很多路线，最后决定只沿熟悉的街道慢走，中途在树下停留。他说不想每次休闲都变成完成清单。没有提供城市、街名、具体日期或同行者。之后关注路线中是否方便停下来，以及听见街道声音的体验。',
  ],
  [
    '拍照与征求同意',
    '一次朋友聚会有人提议上传合照，小林先确认每个人愿不愿意公开，并保留了一张只有桌面物件的照片。他明确表示喜欢记录细节，但不愿为了好看的内容忽略别人的意愿。没有提供朋友姓名、照片原文件、聚会地点或日期。此后讨论图片分享时经常在意公开范围。',
  ],
  [
    '听歌与慢节奏推荐',
    '小林收到一位朋友推荐的歌，没有马上整理歌单，而是先听完再回对方，说自己注意到中间安静下来的片段。他说相比一次收到几十首歌，更想知道对方为何留下这一首。不知道歌名、歌手、朋友姓名或时间。交流偏好是一次聊一个有感觉的细节。',
  ],
  [
    '做饭与具体口味',
    '小林试做一道菜时先减少了调料，尝过后再一点点补，不想照着通用口味照搬。他记录哪些调整适合自己，并强调别把自己的口味当作所有人都喜欢。没有提供菜名、食材禁忌、健康情况或照片。愿意交换小改动带来的差别，不希望聊天变成必须正确的配方教学。',
  ],
  [
    '旧物修补',
    '一个常用物件出现小问题，小林先观察损坏的位置，再寻找能修复的办法，最后决定保留修补痕迹。他说这个痕迹让物件和自己的使用过程有了联系。不知道物件品牌、价格、时间或维修人员。希望了解别人为什么愿意继续使用旧物，而不是用价格判断是否值得。',
  ],
  [
    '观影与不同感受',
    '一次观影讨论里，小林和另一位参与者对结尾感受不同。他没有急着总结双方观点，先问对方最在意的是哪个镜头，再解释自己的理解来自前面的一段声音。没有电影名、演员名、参与者姓名或日期。他明确喜欢具体地讨论分歧，反感一句话宣布标准答案。',
  ],
  [
    '写作与保留分歧',
    '小林修改一段共同写的文字时，发现两个人的意见被压成一句看似一致的话。他保留两种不同表述并标出还没解决的问题，之后再讨论。他说整齐不等于理解一致。没有提供作品、团队、合作者或正式项目名称。这段经历让他关注文字有没有遮住不同判断。',
  ],
  [
    '学习与表达未知',
    '小林学一个不熟悉的概念时，先用自己的话解释，再列出还不懂的地方。一次解释被指出遗漏前提，他补上条件，没有把最初回答藏起来。他说承认不知道有助于接着问。不知道课程、学校、老师或具体概念名称。他更愿意与能耐心交换理解的人学习。',
  ],
  [
    '产品与克制界面',
    '小林试用一个工具时被重复的说明和多个确认步骤打断。他先记录真正影响选择的信息，建议把其余说明收起来。他明确说希望产品直接呈现内容和操作，必要时再解释。没有工具品牌、公司或用户身份。不把这个偏好扩成对所有产品都不要帮助的结论。',
  ],
  [
    '近期整理读书疑问',
    '小林近期正在整理散落的读书问题，打算按仍想继续聊的疑问分组，而不是按读完多少本排序。目前只是在整理，没有完成清单、发布文章或组织活动。他想先与愿意慢聊的人交换一个问题，不急着约固定时间。不知道书名和开始日期。',
  ],
  [
    '近期记录散步观察',
    '小林最近尝试把散步时注意到的小变化写成短记录，想保留细节而不是形成攻略。目前没有公开这批记录，也没有邀请别人同行。他希望看看别人怎样理解停留与观察，不涉及精确地点。不知道记录数量、具体路线和确切日期。',
  ],
  [
    '近期改写一段介绍',
    '小林正在改写一段自我介绍，觉得只列能力和成果不容易让人接话。他希望介绍能说明真正在意的事，同时不泄露私人联系信息。目前尚未定稿，没有对外发布，也没有承诺参与任何合作。不知道用途平台或预定发布时间。',
  ],
  [
    '第二次重读交流',
    '另一回聊书时，小林没有复述上次的结论，而是补充自己重新看一段文字后产生的新疑问。他提醒对方这只是当前理解，不是替作者下定论。交流让他发现自己在意的是理解如何变化。不知道作品、对话者姓名、日期，也没有证据说已经成为好友。',
  ],
  [
    '第二次散步选择',
    '一次原本想走远的散步遇到天气变化，小林选择提前回去，没有把没走完当成失败。他明确说休息时也可以改变计划。没有具体天气、路线、日期或同行者资料。他后来更愿意听别人怎样调整自己的节奏，而不是比较步数。',
  ],
  [
    '第二次图片分享',
    '小林曾在准备分享一张日常图片时发现画面边缘带有私人信息，先裁掉相关部分再决定是否使用。他没有要求保留原始截图来证明真实。没有提供文件、人物、拍摄地点或裁剪工具。他关心表达清楚与尊重边界可以同时成立。',
  ],
  [
    '第二次音乐交流',
    '小林遇到一首自己没马上喜欢的推荐曲，没有简单回不好听，而是问推荐者在哪个场景会想再听。他之后仍保留自己的感受，没有为了配合对方说喜欢。没有歌名、场景具体地点或推荐者姓名。他愿意从不同偏好里认识人。',
  ],
  [
    '第二次做饭调整',
    '小林和别人交换做饭经验时，对方喜欢更重口味，他先说明自己的调整仅代表个人口味，再问对方为什么保留那一步。他没有把聊天变成谁做得正确的比较。没有菜名、健康禁忌、聚餐安排或人物姓名。这次交流让他愿意多问一个具体理由。',
  ],
  [
    '第二次修补判断',
    '另一次物件出问题，小林承认自己没有把握修好，先了解可能的后果，没有为了坚持修补而拆开。他说保留旧物不意味着每次都必须自己动手。没有物件、价钱、维修结果或时间细节。体现他会区分兴趣、能力和需要求助的地方。',
  ],
  [
    '第二次界面反馈',
    '小林给一个界面反馈时没有只说太乱，而是指出重复表单与解释段落占据了主要位置。他希望合并重复信息并保留真正的选择项，没有要求删除授权和隐私控制。没有工具名称、开发团队或上线结果。他在意具体改动能否帮助人做决定。',
  ],
].map(([topic, text], i) => ({ id: 'fixture-' + (i + 1), topic, text }));
const jobs = [
  {
    key: 'bio',
    count: 1,
    min: 500,
    facts,
    request:
      '写简介，至少 700 个非空白中文字符，第一人称 Agent 名叫知遥，主人是模拟小林，性格温和、好奇、善于留意细节。只根据材料，不写能力清单。',
  },
  ...[0, 5].map((start) => ({
    key: 'interests',
    start,
    count: 5,
    min: 200,
    facts: facts.slice(start, start + 5),
    request:
      '为每个提供的独立兴趣写一项，合并实际观点与偏好。每项至少 300 个非空白中文字符。不要写科普教程，不创造生活事实。',
  })),
  {
    key: 'recent',
    count: 3,
    min: 200,
    facts: facts.slice(10, 13),
    request:
      '写三项近期在做的事，分别对应材料，保持正在做和尚未完成的真实状态。每项至少 300 个非空白中文字符。',
  },
  {
    key: 'connections',
    count: 5,
    min: 200,
    facts: facts.slice(0, 10),
    request:
      '综合这些材料写至少五个不同的想认识的人的方向，每项至少 300 个非空白中文字符。每项讲清谁、为什么、真实兴趣依据、如何开场和继续，不把未发生的交流写成已发生。',
  },
  ...[0, 4, 8, 12, 16].map((start) => ({
    key: 'memories',
    start,
    count: 4,
    min: 300,
    facts: facts.slice(start, start + 4),
    request:
      '分别整理四条独立事件记忆，一条对应一份材料。每条至少 450 个非空白中文字符。保留真实细节，分析其对理解这个人的意义；缺失的名字、日期、结果保持未知，不创造新事件。',
  })),
];
await mkdir('.agentnet-audit', { recursive: true });
const outputs = [];
const length = (t) => [...t.replace(/\s/gu, '')].length;
for (let batch = 0; batch < jobs.length; batch += 2) {
  const settled = await Promise.allSettled(
    jobs.slice(batch, batch + 2).map(async (job) => {
      let previous;
      let gap;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await model.json(rules, {
          fixture_notice:
            '隔离测试，全部资料为虚构，不属于真实用户；没有联网社交动作，只生成本地待验证草稿。',
          evidence: job.facts,
          task:
            job.request +
            ' 只返回 JSON {items:[{content,evidence_ids}]}。每项必须一个段落，不在项内插入空行。',
          ...(gap ? { repair: gap, previous } : {}),
        });
        const items = result.items;
        if (
          Array.isArray(items) &&
          items.length >= job.count &&
          items.every(
            (x) =>
              typeof x.content === 'string' &&
              length(x.content) >= job.min &&
              Array.isArray(x.evidence_ids) &&
              x.evidence_ids.length &&
              x.evidence_ids.every((id) => job.facts.some((f) => f.id === id)),
          )
        )
          return { ...job, items };
        previous = result;
        gap = `需要至少 ${job.count} 项，每项至少 ${job.min} 个非空白字符，实际长度 ${items?.map((x) => length(x.content || '')).join(',')}。只使用提供的真实测试证据，补足内容而不是添加虚构事件。`;
      }
      throw Error('Incomplete model field ' + job.key + ' ' + gap);
    }),
  );
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status !== 'fulfilled') throw r.reason;
    outputs.push(r.value);
    console.log(
      'PASS model ' +
        r.value.key +
        (r.value.start ?? '') +
        ' ' +
        r.value.items.map((x) => length(x.content)).join(','),
    );
  }
  await writeFile(
    '.agentnet-audit/rich-model-parts.json',
    JSON.stringify(outputs, null, 2),
  );
}
const entries = (key) =>
  outputs.filter((o) => o.key === key).flatMap((o) => o.items);
const text = (key) =>
  entries(key)
    .map((x, i) => `${i + 1}. ${x.content.replace(/\n\s*\n/g, '\n')}`)
    .join('\n\n');
const fields = {
  name: '小林',
  avatar: '',
  bio: entries('bio')
    .map((x) => x.content)
    .join('\n\n'),
  interests: text('interests'),
  recent: text('recent'),
  connections: text('connections'),
};
const draft = {
  identity_card: {
    agent_name: '知遥',
    agent_description: '模拟小林的具名伙伴',
    human_description: '喜欢慢聊、观察与具体交流的模拟主人',
    working_languages: ['zh'],
    offering: [],
    seeking: [],
  },
  network_goal:
    '认识愿意慢慢聊书、交换散步观察、讨论具体选择的人，从一个真实细节开始交流。',
  twin_profile: {
    portrait: {
      prefill_version: 'portrait-rich-2026-10-14',
      fields,
      memories: entries('memories').map((m) => ({
        id: randomUUID(),
        content: m.content,
        showOnHome: false,
      })),
    },
  },
  field_provenance: {
    twin_profile: 'agent_user_context',
    network_goal: 'agent_inferred',
    'identity_card.agent_name': 'agent_inferred',
    'identity_card.agent_description': 'agent_inferred',
    'identity_card.human_description': 'agent_user_context',
    'identity_card.working_languages': 'agent_inferred',
    'identity_card.offering': 'agent_inferred',
    'identity_card.seeking': 'agent_inferred',
  },
};
await writeFile(
  '.agentnet-audit/rich-model-complete-draft.json',
  JSON.stringify(draft, null, 2),
);
if (process.env.AGENTNET_CLI_BINARY) {
  execFileSync(
    process.env.AGENTNET_CLI_BINARY,
    [
      '--format',
      'json',
      'validate-profile',
      '--draft-file',
      '.agentnet-audit/rich-model-complete-draft.json',
    ],
    { stdio: 'pipe' },
  );
}
console.log(
  'PASS full synthetic model draft saved; ' +
    draft.twin_profile.portrait.memories.length +
    ' memories; no real registration or messages.',
);
