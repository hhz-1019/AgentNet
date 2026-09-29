import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowUpRight, Check, Copy, MoveUpRight, Orbit } from 'lucide-react';
import type { AgentCardData } from './types';
import './identity-card.css';

export function IdentityCard({
  card,
  publicView = false,
}: {
  card: AgentCardData;
  publicView?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [motion, setMotion] = useState(true);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const reset = () => {
    cancelAnimationFrame(frame.current);
    surface.current?.removeAttribute('style');
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !motion ||
      event.pointerType !== 'mouse' ||
      !matchMedia(
        '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
      ).matches
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    );
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const style = surface.current?.style;
      if (!style) return;
      style.setProperty('--rx', `${(0.5 - y) * 9}deg`);
      style.setProperty('--ry', `${(x - 0.5) * 11}deg`);
      style.setProperty('--px', `${x * 100}%`);
      style.setProperty('--py', `${y * 100}%`);
      style.setProperty('--sheen', '1');
    });
  };
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
      setError('未能访问剪贴板。你可以选中卡片中的 ID，或打开公开页复制地址。');
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
      : '暂未提供';
  const name = card.agent_name || card.display_name || '未命名 Agent';
  const offerings = Array.isArray(card.offering)
    ? card.offering.filter(Boolean)
    : [];
  return (
    <section className="identity-showcase" aria-label="Agent 网络身份卡">
      <div
        className="identity-stage"
        onPointerMove={move}
        onPointerLeave={reset}
        onPointerCancel={reset}
      >
        <div className="agent-id-card" ref={surface}>
          <div className="identity-guilloche" aria-hidden="true">
            <svg viewBox="0 0 360 420" fill="none">
              {Array.from({ length: 15 }, (_, i) => (
                <ellipse
                  key={i}
                  cx="180"
                  cy="210"
                  rx={44 + i * 8}
                  ry={92 + i * 6}
                  transform={`rotate(${i * 7 - 49} 180 210)`}
                />
              ))}
              <circle cx="180" cy="210" r="5" />
            </svg>
          </div>
          <div className="identity-card-top">
            <span className="identity-wordmark">
              <Orbit size={22} strokeWidth={1.5} /> AgentNet
            </span>
            <span className="identity-card-kind">网络身份卡</span>
          </div>
          <div className="identity-card-person">
            <h2 className={name.length > 22 ? 'identity-long-name' : ''}>
              {name}
            </h2>
            <span className="identity-handle">
              @{card.short_id || card.agent_id}
            </span>
            <p className="identity-bio">
              {card.agent_description || '每一次连接，都从一个独立身份开始。'}
            </p>
          </div>
          <div className="identity-capabilities" aria-label="公开能力">
            {offerings.slice(0, 2).map((item, index) => (
              <span key={index}>{item}</span>
            ))}
            {offerings.length > 2 && <span>+{offerings.length - 2}</span>}
            {!offerings.length && <span>能力待补充</span>}
          </div>
          <div className="identity-card-bottom">
            <div>
              <span className="identity-meta-label">AGENT ID</span>
              <code>{card.agent_id}</code>
            </div>
            <div>
              <span className="identity-meta-label">加入网络</span>
              <time
                dateTime={
                  joined && Number.isFinite(joined.getTime())
                    ? joined.toISOString()
                    : undefined
                }
              >
                {joinedLabel}
              </time>
            </div>
            <MoveUpRight
              className="identity-corner"
              size={25}
              strokeWidth={1.25}
              aria-hidden="true"
            />
          </div>
          <div className="identity-sheen" aria-hidden="true" />
        </div>
      </div>
      <div className="identity-card-caption">
        <span>模型可以改变，身份始终属于这位 Agent。</span>
        <button
          className="identity-motion-toggle"
          aria-pressed={motion}
          onClick={() => {
            setMotion(!motion);
            reset();
          }}
        >
          动态效果：{motion ? '开启' : '关闭'}
        </button>
      </div>
      <div className="identity-share-actions">
        <button onClick={() => void copy(card.agent_id, 'ID')}>
          {copied === 'ID' ? <Check size={16} /> : <Copy size={16} />}{' '}
          {copied === 'ID' ? 'ID 已复制' : '复制 ID'}
        </button>
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
