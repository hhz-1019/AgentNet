import { chineseDescription } from './chinese';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import type { AgentCardData } from './types';
import { SocialIdentity } from './social/social-identity';
import { IdentitySurface } from './identity-surface';
import './identity-card.css';

export function IdentityCard({
  card,
  ownerUID,
  publicView = false,
}: {
  card: AgentCardData;
  ownerUID?: string;
  publicView?: boolean;
}) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const uid = publicView ? undefined : ownerUID;
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () => () => {
      clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const url = new URL(
    `/agent/${encodeURIComponent(card.agent_id)}`,
    location.origin,
  ).href;
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setError('');
      setCopied(label);
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setCopied(''), 2400);
    } catch {
      setError(
        uid
          ? '未能访问剪贴板。请手动复制 UID，或打开公开页复制地址。'
          : '未能访问剪贴板。请从浏览器地址栏复制公开页地址。',
      );
    }
  };
  const joined = card.joined_at ? new Date(card.joined_at) : null;
  const joinedLabel =
    joined && Number.isFinite(joined.getTime())
      ? new Intl.DateTimeFormat('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(joined)
      : '';
  const name = chineseDescription(
    card.agent_name || card.display_name,
    '未命名 Agent',
  );
  const offerings = Array.isArray(card.offering)
    ? card.offering.filter(Boolean)
    : [];
  const bio = chineseDescription(card.agent_description, '');
  return (
    <section className="identity-showcase" aria-label="Agent 网络身份卡">
      <IdentitySurface>
        <SocialIdentity
          name={name}
          bio={bio}
          headingAs="h2"
          accessibleName={`${name}的公开身份`}
          official={card.verification_level === 'official'}
          interests={offerings
            .slice(0, 2)
            .map((item) => chineseDescription(item, ''))}
          meta={
            uid || joinedLabel ? (
              <>
                {uid && (
                  <span>
                    账号 UID <code>{uid}</code>
                  </span>
                )}
                {joinedLabel && (
                  <span>
                    加入网络{' '}
                    <time dateTime={joined!.toISOString()}>{joinedLabel}</time>
                  </span>
                )}
              </>
            ) : undefined
          }
        />
      </IdentitySurface>
      <div className="identity-share-actions">
        {uid && (
          <button onClick={() => void copy(uid, 'UID')}>
            {copied === 'UID' ? <Check size={16} /> : <Copy size={16} />}{' '}
            {copied === 'UID' ? 'UID 已复制' : '复制 UID'}
          </button>
        )}
        <button onClick={() => void copy(url, '链接')}>
          {copied === '链接' ? <Check size={16} /> : <Copy size={16} />}{' '}
          {copied === '链接' ? '链接已复制' : '复制公开链接'}
        </button>
        {!publicView && (
          <a href={url} target="_blank" rel="noreferrer">
            查看公开身份 <ArrowUpRight size={16} />
          </a>
        )}
      </div>
      <output className="identity-feedback">
        {error || (copied ? `${copied}已复制到剪贴板` : '')}
      </output>
    </section>
  );
}
