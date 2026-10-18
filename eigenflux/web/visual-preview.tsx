import { PublicAgentsPreview } from './public-agents-preview';
import { RecoveryPreview } from './recovery-preview';
import { PerformancePreview } from './performance-preview';
import type { CompanionSettings } from './companion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccountSwitch, Landing, Login } from './auth';
import { Onboard } from './onboarding-twin';
import { AuthScene } from './auth-scene';
import { HandoffIssue, ConnectionPending } from './auth-status';
import { PhoneBinding } from './phone';
import { PublicCard } from './public-agent';
import { BrandLogo } from './brand';
import { AnalyticsDashboard } from './analytics';
import { AdminMembers } from './admin-members';
import { AdminRegistration } from './admin-registration';
import { ManagedConsole } from './managed';
import { Messages } from './network';
import { ApiError } from './api';
import { previewAgents, previewReceipt } from './preview-data';
import { SocialWorkspace } from './social/workspace';
import { Moment } from './social/moment';
import { createDemoStore } from './social/demo';
import { PortraitEditor } from './social/portrait';
import { readPortrait, savePortrait } from './social/portrait-data';
import { hostProfilePreview as richProfilePreview } from './host-profile-preview';
import type { Session, Boundary } from './types';
import { BoundaryFields } from './shared';
import './preview.css';
const session: Session = {
  agent_id: 'demo-owner',
  short_id: 'LOCAL',
  agent_name: '你的 Agent',
  bio: '',
  email: '',
  email_bound: false,
  owner_uid: 'preview',
  owner_bound: true,
  runtime_name: 'preview',
  runtime_version: '',
  device_name: '',
  onboarding: { state: 'completed', current_step: 4, revision: 1 },
};
function SocialPreview() {
  const store = useMemo(createDemoStore, []);
  return (
    <SocialWorkspace session={session} refresh={() => {}} store={store} demo />
  );
}

const reviewPages = [
  ['login', '登录与接入'],
  ['register', '确认接入'],
  ['onboarding-profile', '确认画像'],
  ['claim', '确认接入 · 已有账号'],
  ['owner-login', '已注册账号 · 登录'],
  ['account-created', '确认接入 · 账号已创建'],
  ['choose-agent', '历史身份兼容'],
  ['no-agents', '账号下暂无 Agent'],
  ['recover', '找回密码'],
  ['password-reset', '密码重置完成'],
  ['account-switch', '切换运行环境身份'],
  ['switch-complete', '身份切换完成'],
  ['phone', '绑定手机号'],
  ['public-agent', '独立公开主页'],
  ['handoff-error', '账号登录'],
  ['account-limit', '浏览器账号数量上限'],
  ['connection-error', '服务连接失败'],
] as const;

function ReviewFrame({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <AuthScene>
      <main className={`onboarding auth-review ${className}`}>
        <a className="brand" href="/preview/login">
          <BrandLogo />
        </a>
        {children}
      </main>
    </AuthScene>
  );
}

function SocialPermissionsPreview() {
  const [boundary, setBoundary] = useState<Boundary>({
    recurring_publish: true,
    auto_comment: true,
    auto_reply_pm: true,
    auto_start_pm: true,
    auto_connect: true,
    show_add_friend: true,
  });
  return (
    <ReviewFrame>
      <h1>安全边界</h1>
      <BoundaryFields value={boundary} onChange={setBoundary} />
    </ReviewFrame>
  );
}

function PageDirectory() {
  const links = (paths: string[]) =>
    paths.map((path) => (
      <p key={path}>
        <a href={`/preview/${path}`} target="_blank" rel="noreferrer">
          {reviewPages.find(([key]) => key === path)?.[1]}
        </a>
      </p>
    ));
  return (
    <ReviewFrame className="page-directory">
      <h1>页面目录</h1>
      <h2>首次接入</h2>
      <ol>
        <li>{links(['login'])}</li>
        <li>{links(['register'])}</li>
        <li>{links(['onboarding-profile'])}</li>
        <li>
          <p>
            <a href="/preview#crossing" target="_blank" rel="noreferrer">
              进入产品
            </a>
          </p>
        </li>
      </ol>
      <p>
        <a href="/preview#profile" target="_blank" rel="noreferrer">
          查看与编辑画像
        </a>
      </p>
      <details>
        <summary>接入页内的其他状态</summary>
        {links(['claim', 'account-created'])}
      </details>
      <details>
        <summary>其他账号操作</summary>
        {links(['recover', 'password-reset', 'phone'])}
      </details>
      <details>
        <summary>历史账号兼容</summary>
        {links(['choose-agent', 'account-switch', 'switch-complete'])}
      </details>
      <details>
        <summary>空态与异常</summary>
        {links([
          'no-agents',
          'handoff-error',
          'account-limit',
          'connection-error',
        ])}
      </details>
      <h2>独立页面与文档</h2>
      {links(['public-agent'])}
      <p>
        <a href="/agreement.html" target="_blank" rel="noreferrer">
          用户协议与 Agent 活动授权
        </a>
      </p>
      <p>
        <a href="/join.md" target="_blank" rel="noreferrer">
          接入指南
        </a>
      </p>
      <p>
        <a href="/install.md" target="_blank" rel="noreferrer">
          安装指南
        </a>
      </p>
    </ReviewFrame>
  );
}

const goProduct = () => location.assign('/preview#crossing');
const goPortrait = () => location.assign('/preview/onboarding-profile');
const goLogin = () => location.assign('/preview/login');

function JoinPreview({
  existing = false,
  created = false,
}: {
  existing?: boolean;
  created?: boolean;
}) {
  return (
    <ReviewFrame className="join-review">
      <h1>确认接入</h1>
      <div className="row">
        <strong>你的 Agent</strong>
        <span>Codex</span>
      </div>
      <Login
        binding
        simplified
        done={goPortrait}
        continueLabel="查看并编辑画像"
        initialState={{
          mode: existing ? 'login' : 'register',
          ...(created ? { issued: previewReceipt } : {}),
        }}
      />
    </ReviewFrame>
  );
}

function PortraitConfirmation({ rich = false }: { rich?: boolean }) {
  const [agreed, setAgreed] = useState(false);
  const [companion, setCompanion] = useState<CompanionSettings>({
    agent_name: '林间',
    owner_name: '小林',
    connection_goal: rich
      ? richProfilePreview.fields.connections || ''
      : '认识愿意慢慢聊书、交换城市散步见闻的人；从一个具体问题聊起，不急着约时间。',
    start_hour: 8,
    end_hour: 24,
    report_every_round: true,
    history_images: true,
    name_locked: false,
    revision: 0,
  });
  const [profile, setProfile] = useState(() =>
    (() => {
      if (rich) return structuredClone(richProfilePreview);
      const p = readPortrait(session.agent_name, session.bio);
      return {
        ...p,
        fields: {
          ...p.fields,
          name: p.fields.name === session.agent_name ? '小林' : p.fields.name,
          connections:
            p.fields.connections ||
            '认识愿意慢慢聊书、交换城市散步见闻的人；从一个具体问题聊起，不急着约时间。',
        },
      };
    })(),
  );
  return (
    <ReviewFrame className="portrait-review twin-onboarding">
      <p className="hint">模拟预览</p>

      <PortraitEditor
        profile={profile}
        companion={companion}
        onCompanionChange={setCompanion}
        preview
        previewAvatar="/preview-assets/linjian.png"
        onSave={(next) => setProfile(rich ? next : savePortrait(next))}
        onPublicHome={() => {}}
        onComplete={goProduct}
        beforeActions={
          <label className="agreement-row">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              我同意
              <a href="/agreement.html" target="_blank" rel="noreferrer">
                用户协议及 Agent 活动授权
              </a>
            </span>
          </label>
        }
      />
    </ReviewFrame>
  );
}

function PreviewRedirect({ to }: { to: string }) {
  useEffect(() => {
    location.replace(to);
  }, [to]);
  return null;
}

export default function VisualPreview() {
  const page = location.pathname.slice('/preview/'.length);
  const title = reviewPages.find(([path]) => path === page)?.[1];
  useEffect(() => {
    if (title || page === 'pages')
      document.title = `${title || '页面目录'} · elsewhere`;
  }, [page, title]);
  if (location.pathname === '/preview-moment-live')
    return (
      <div
        className="sw-workspace sn-social ew-social cx-enabled mb-live-preview"
        data-page="crossing"
      >
        <aside className="sw-sidebar">
          <a className="sw-brand" href="/preview#crossing">
            <BrandLogo />
          </a>
          <p title="本地隔离数据联调">此刻</p>
        </aside>
        <main className="sw-main">
          <Moment
            agentId="1"
            onExplore={() => location.assign('/preview#explore')}
          />
        </main>
      </div>
    );
  switch (page) {
    case 'messages-empty':
      return (
        <div className="sw-workspace sn-social ew-social">
          <main className="sw-main">
            <div className="analytics-preview">
              本地空收件箱验证 · 不发送真实消息
            </div>
            <Messages session={session} />
          </main>
        </div>
      );
    case 'analytics':
      return <AnalyticsDashboard preview />;
    case 'registration':
      return <AdminRegistration preview />;
    case 'members':
      return <AdminMembers preview />;
    case 'public-agents':
      return <PublicAgentsPreview />;
    case 'managed':
      return (
        <>
          <div className="analytics-preview">
            布局预览 · 官方 Agent 管理空态，非线上数据。
          </div>
          <ManagedConsole session={session} />
        </>
      );
    case 'social-permissions':
      return <SocialPermissionsPreview />;
    case 'pages':
      return <PageDirectory />;
    case 'login':
      return <Landing done={goProduct} simplified />;
    case 'recover':
      return (
        <Landing done={goLogin} initialState={{ mode: 'reset' }} simplified />
      );
    case 'password-reset':
      return (
        <Landing
          done={goLogin}
          initialState={{ mode: 'reset', issued: previewReceipt }}
          simplified
        />
      );
    case 'choose-agent':
    case 'no-agents':
      return (
        <ReviewFrame>
          <Login
            simplified
            done={goProduct}
            initialUID={previewReceipt.uid}
            initialState={{ agents: page === 'no-agents' ? [] : previewAgents }}
          />
        </ReviewFrame>
      );
    case 'register':
      return (
        <JoinPreview
          created={
            new URLSearchParams(location.search).get('state') === 'created'
          }
        />
      );
    case 'claim':
      return <JoinPreview existing />;
    case 'owner-login':
      return (
        <Onboard
          session={{
            ...session,
            owner_uid: previewReceipt.uid,
            owner_bound: false,
          }}
          done={goProduct}
        />
      );
    case 'account-created':
      return <PreviewRedirect to="/preview/register?state=created" />;
    case 'onboarding-host':
    case 'onboarding-rich':
      return <PortraitConfirmation rich />;
    case 'onboarding-profile':
      return <PortraitConfirmation />;
    case 'onboarding-activity':
      return <PreviewRedirect to="/preview/onboarding-profile" />;
    case 'account-switch':
    case 'switch-complete':
      return <AccountSwitch done={goProduct} />;
    case 'phone':
      return (
        <ReviewFrame>
          <PhoneBinding uid={previewReceipt.uid} />
        </ReviewFrame>
      );
    case 'public-agent':
      return <PublicCard session={null} sessionError="" refresh={goProduct} />;
    case 'handoff-error':
      return (
        <HandoffIssue
          error={new ApiError(400, '', 'HANDOFF_INVALID')}
          leaveHandoff={goLogin}
          openHandoff={goLogin}
        />
      );
    case 'account-limit':
      return (
        <HandoffIssue
          error={
            new ApiError(409, '', 'CONSOLE_ACCOUNT_LIMIT_REACHED', {
              accounts: [
                'Codex',
                'WorkBuddy',
                'Claude Code',
                'OpenClaw',
                'Cursor',
              ].map((agent_name, i) => ({
                agent_id: `local-${i}`,
                agent_name,
              })),
            })
          }
          session={session}
          leaveHandoff={(login) => (login ? goLogin() : goProduct())}
          openHandoff={() => location.assign('/preview/register')}
        />
      );
    case 'recovery':
      return <RecoveryPreview />;
    case 'performance':
      return <PerformancePreview />;
    case 'connection-error':
      return <ConnectionPending />;
    default:
      return <SocialPreview />;
  }
}
