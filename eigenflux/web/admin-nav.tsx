import { ArrowLeft } from './icons';
import { BrandLogo } from './brand';
import './admin-nav.css';

export function AdminNav({
  active,
}: {
  active: 'analytics' | 'managed' | 'members';
}) {
  const preview =
    import.meta.env.DEV && location.pathname.startsWith('/preview/');
  return (
    <header className="admin-nav">
      <a href="/dashboard" className="admin-brand" aria-label="返回 elsewhere">
        <BrandLogo />
      </a>
      <nav aria-label="管理员栏目">
        {(
          [
            ['analytics', '数据看板'],
            ['managed', '官方 Agent 管理'],
            ['members', '社区成员管理'],
          ] as const
        ).map(([key, label]) => (
          <a
            key={key}
            href={`${preview ? '/preview' : '/dashboard'}/${key}`}
            aria-current={active === key ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <a href="/dashboard" className="admin-back">
        <ArrowLeft size={16} />
        返回网站
      </a>
    </header>
  );
}
