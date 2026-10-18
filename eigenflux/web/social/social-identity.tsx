import { AgentAvatar } from '../avatar';
import { useId, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, BadgeCheck } from '../icons';
import { BrandLogo } from '../brand';
import '../identity-card.css';
import './profile-design.css';
import './identity-detail.css';

export type SocialIdentityProps = {
  name: string;
  ownerName?: string;
  bio?: string;
  avatarUrl?: string;
  avatar?: string;
  agentId?: string;
  interests?: string | string[];
  actions?: ReactNode;
  accessibleName?: string;
  official?: boolean;
  headingAs?: 'h1' | 'h2';
  meta?: ReactNode;
  details?: Array<{ label: string; value: string }>;
  onEdit?: () => void;
};

export function SocialIdentity({
  name,
  ownerName,
  bio,
  avatarUrl,
  avatar,
  agentId,
  interests,
  actions,
  accessibleName = `${name}的主页`,
  official = false,
  headingAs: Heading = 'h1',
  meta,
  details = [],
  onEdit,
}: SocialIdentityProps) {
  const [failedAvatar, setFailedAvatar] = useState('');
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const visibleDetails = details.filter((detail) => detail.value.trim());
  const hasDetails = visibleDetails.length > 0 || Boolean(onEdit);
  const showingDetails = expanded && hasDetails;
  const interestText = Array.isArray(interests)
    ? interests.filter(Boolean).join(' · ')
    : interests;
  return (
    <header
      className={`elsewhere-identity${hasDetails ? ' ew-identity-with-details' : ''}`}
      aria-label={accessibleName}
      data-expanded={showingDetails}
    >
      <div className="elsewhere-identity-brand">
        <BrandLogo inverse />
        {official && (
          <span className="elsewhere-identity-official">
            <BadgeCheck size={17} aria-hidden="true" /> 官方 Agent
          </span>
        )}
      </div>
      <div className="elsewhere-identity-person">
        <span className="elsewhere-identity-avatar">
          {avatarUrl && avatarUrl !== failedAvatar ? (
            <img
              src={avatarUrl}
              alt=""
              onError={() => setFailedAvatar(avatarUrl)}
            />
          ) : (
            <AgentAvatar agentId={agentId} avatar={avatar} name={name} />
          )}
        </span>
        <div className="elsewhere-identity-copy">
          <Heading>{name}</Heading>
          {ownerName && (
            <p className="elsewhere-identity-owner">{ownerName}的 Agent</p>
          )}
          {bio && !showingDetails && (
            <p className="elsewhere-identity-bio">{bio}</p>
          )}
        </div>
      </div>
      {hasDetails && (
        <div
          className="ew-identity-more"
          id={detailsId}
          aria-hidden={!showingDetails}
          inert={!showingDetails}
        >
          <div className="ew-identity-more-inner">
            {visibleDetails.length > 0 ? (
              <dl className="ew-identity-fragments">
                {visibleDetails.map((detail, index) => (
                  <div
                    className="ew-identity-fragment"
                    key={`${detail.label}-${index}`}
                  >
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="ew-identity-empty">还没有填写资料</p>
            )}
          </div>
        </div>
      )}
      {(interestText || meta || actions || hasDetails) && (
        <div className="elsewhere-identity-bottom">
          <div className="elsewhere-identity-context">
            {interestText && !showingDetails && (
              <p className="elsewhere-identity-interests">{interestText}</p>
            )}
            {meta && <div className="elsewhere-identity-meta">{meta}</div>}
          </div>
          {(actions || hasDetails) && (
            <div className="elsewhere-identity-actions">
              {hasDetails && (
                <button
                  type="button"
                  className="ew-identity-details-toggle"
                  aria-expanded={showingDetails}
                  aria-controls={detailsId}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {showingDetails ? '收起资料' : '关于我'}
                  {showingDetails ? (
                    <ArrowDownLeft size={16} aria-hidden="true" />
                  ) : (
                    <ArrowUpRight size={16} aria-hidden="true" />
                  )}
                </button>
              )}
              {actions}
              {showingDetails && onEdit && (
                <button type="button" onClick={onEdit}>
                  编辑资料 <ArrowUpRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
