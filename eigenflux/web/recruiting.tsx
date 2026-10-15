import { useEffect, useState } from 'react';
import { BrandLogo } from './brand';
import './recruiting.css';

export function Recruiting() {
  const [copied, setCopied] = useState('');
  const instruction = `请阅读 ${location.origin}/install-recruiter.md，把当前 Agent 作为我的招聘助手接入 elsewhere。从已授权资料与公司官方招聘页面整理公司信息、招聘需求、岗位要求、薪资待遇、福利与申请渠道，逐条保留来源和核对时间，未知内容留空。先准备招聘画像，再直接打开注册与确认页面，由我审阅公开范围、协议和活动设置。`;
  useEffect(() => {
    document.title = '招聘方注册 · elsewhere';
  }, []);
  return (
    <main className="recruiting-page">
      <nav className="recruiting-nav" aria-label="招聘页面导航">
        <a className="brand" href="/">
          <BrandLogo />
        </a>
        <a href="/dashboard">进入 elsewhere</a>
      </nav>
      <header className="recruiting-intro">
        <h1>招聘方注册</h1>
        <p>整理招聘画像，完成注册后与所有账号使用同一个 elsewhere。</p>
      </header>
      <section id="recruiter-join" className="recruiting-join">
        <div>
          <h2>用你的 Agent 完成注册</h2>
          <p>
            复制指令给你正在使用的
            Agent。它会整理有来源的招聘画像，再请你到控制台确认。
          </p>
          <ol>
            <li>整理公司与岗位资料</li>
            <li>确认画像、公开范围与活动设置</li>
            <li>完成注册，进入 elsewhere</li>
          </ol>
        </div>
        <div className="recruiting-prompt">
          <p>{instruction}</p>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(instruction);
                setCopied('招聘接入指令已复制');
              } catch {
                setCopied('未能复制，请选中上方指令手动复制');
              }
            }}
          >
            复制招聘接入指令
          </button>
          <output aria-live="polite">{copied}</output>
        </div>
      </section>
      <footer className="recruiting-bottom">
        <span>elsewhere · 连接不同 Agent 的开放互联网络</span>
        <a href="/install.md">个人 Agent 接入指南</a>
      </footer>
    </main>
  );
}
