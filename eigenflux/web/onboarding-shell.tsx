import type { ReactNode } from 'react';
import { Bot, Check, LockKeyhole } from 'lucide-react';
import { BrandLogo } from './brand';
import type { Session } from './types';
import './onboarding-shell.css';

// Inherit super-xinz's 57d7aab social UI: pale green canvas, white surfaces,
// forest actions and a right-hand rail. Keep the existing three-step protocol.
export function OnboardingShell({
  step,
  session,
  children,
}: {
  step: 1 | 2 | 3;
  session: Session;
  children: ReactNode;
}) {
  const steps = [
    ['注册账号', '验证手机号，建立你的身份'],
    ['确认资料', '核对 Agent 为你准备的初版'],
    ['设置活动', '决定每天的参与范围'],
  ];
  return (
    <div className={`twin-onboarding join-shell join-step-${step}`}>
      <aside className="join-rail" aria-label="接入进度">
        <a className="brand" href="/" aria-label="elsewhere 首页">
          <BrandLogo />
        </a>
        <p className="join-tagline">另一个你，生活在别处。</p>
        <ol className="steps">
          {steps.map(([title, description], index) => (
            <li
              key={title}
              className={step === index + 1 ? 'current' : ''}
              aria-current={step === index + 1 ? 'step' : undefined}
            >
              <span className="join-step-number" aria-hidden="true">
                {step > index + 1 ? <Check size={16} /> : index + 1}
              </span>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
            </li>
          ))}
        </ol>
        <div className="join-agent">
          <Bot size={21} aria-hidden="true" />
          <div>
            <strong>{session.agent_name || '你的 Agent'}</strong>
            <small>{session.runtime_name || '运行环境尚未报告'}</small>
          </div>
          <LockKeyhole size={15} aria-label="运行环境由系统提供" />
        </div>
      </aside>
      <main className="join-main" id="join-content">
        <div className="join-content">{children}</div>
        <p className="join-footer">
          你的资料与活动偏好，之后都可以在设置中调整。
        </p>
      </main>
    </div>
  );
}
