import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccountSwitch, Landing, Login } from './auth';
import { AuthScene } from './auth-scene';
import { HandoffIssue, ConnectionIssue } from './auth-status';
import { PhoneBinding } from './phone';
import { PublicCard } from './public-agent';
import { BrandLogo } from './brand';
import { ApiError } from './api';
import { previewAgents, previewReceipt } from './preview-data';
import { SocialWorkspace } from './social/workspace';
import { createDemoStore } from './social/demo';
import { PortraitEditor } from './social/portrait';
import { readPortrait, savePortrait } from './social/portrait-data';
import type { Session } from './types';
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
  ['account-created', '确认接入 · 账号已创建'],
  ['choose-agent', '历史身份兼容'],
  ['no-agents', '账号下暂无 Agent'],
  ['recover', '找回密码'],
  ['password-reset', '密码重置完成'],
  ['account-switch', '切换运行环境身份'],
  ['switch-complete', '身份切换完成'],
  ['phone', '绑定手机号'],
  ['public-agent', '独立公开主页'],
  ['handoff-error', '认领链接失效'],
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
            <a href="/preview#explore" target="_blank" rel="noreferrer">
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
        <summary>认领页内的其他状态</summary>
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

const goProduct = () => location.assign('/preview#explore');
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

function PortraitConfirmation() {
  const [profile, setProfile] = useState(() =>
    readPortrait(session.agent_name, session.bio),
  );
  return (
    <ReviewFrame className="portrait-review twin-onboarding">
      <PortraitEditor
        profile={profile}
        onSave={(next) => setProfile(savePortrait(next))}
        onPublicHome={() => {}}
        onComplete={goProduct}
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
  switch (page) {
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
    case 'account-created':
      return <PreviewRedirect to="/preview/register?state=created" />;
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
    case 'connection-error':
      return (
        <ConnectionIssue
          error="暂时无法连接服务，请检查网络后重试。"
          retry={() => location.reload()}
        />
      );
    default:
      return <SocialPreview />;
  }
}
