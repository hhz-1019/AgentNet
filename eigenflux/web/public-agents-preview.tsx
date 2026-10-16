import { PublicAgents, type PublicAgentsData } from './public-agents';
import catalog from '../overlay/api/consolev2/celebrity_catalog.json';
import './managed.css';
const data: PublicAgentsData = {
  profiles: catalog,
  boards: [
    {
      key: 'tencent',
      company: '腾讯',
      provider: 'tencent',
      url: 'https://careers.tencent.com',
    },
    {
      key: 'netease',
      company: '网易',
      provider: 'netease',
      url: 'https://hr.163.com/job-list.html',
    },
    {
      key: 'baidu',
      company: '百度',
      provider: 'baidu',
      url: 'https://talent.baidu.com/jobs/social-list',
    },
    {
      key: 'meituan',
      company: '美团',
      provider: 'meituan',
      url: 'https://zhaopin.meituan.com/web/social',
    },
    {
      key: 'ctrip',
      company: '携程',
      provider: 'ctrip',
      url: 'https://job.ctrip.com/#/experienced/jobList',
    },
    {
      key: 'bytedance',
      company: '字节跳动',
      provider: 'bytedance',
      url: 'https://jobs.bytedance.com/experienced/position',
    },
    {
      key: 'xiaomi',
      company: '小米',
      provider: 'xiaomi',
      url: 'https://xiaomi.jobs.f.mioffice.cn/index',
    },
    {
      key: 'dji',
      company: '大疆',
      provider: 'dji',
      url: 'https://we.dji.com/zh-CN/social',
    },
    {
      key: 'anthropic',
      company: 'Anthropic',
      provider: 'greenhouse',
      url: 'https://job-boards.greenhouse.io/anthropic',
    },
    {
      key: 'cloudflare',
      company: 'Cloudflare',
      provider: 'greenhouse',
      url: 'https://job-boards.greenhouse.io/cloudflare',
    },
    {
      key: 'figma',
      company: 'Figma',
      provider: 'greenhouse',
      url: 'https://job-boards.greenhouse.io/figma',
    },
    {
      key: 'stripe',
      company: 'Stripe',
      provider: 'greenhouse',
      url: 'https://stripe.com/jobs/search',
    },
    {
      key: 'openai',
      company: 'OpenAI',
      provider: 'ashby',
      url: 'https://jobs.ashbyhq.com/openai',
    },
  ],
  states: [],
  worker_configured: false,
};
export function PublicAgentsPreview() {
  return (
    <main className="managed-page public-agent-preview">
      <header>
        <a href="/preview/managed">官方 Agent 管理</a>
        <h1>名人管理</h1>
        <p>本地界面预览 · 人物资料来自公开来源，操作不写入账号。</p>
      </header>
      <PublicAgents fixture={data} />
    </main>
  );
}
