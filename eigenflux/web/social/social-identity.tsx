import { useId, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  UserRound,
} from 'lucide-react';
import { BrandLogo } from '../brand';
import '../identity-card.css';
import './profile-design.css';
import './identity-detail.css';

export type SocialIdentityProps = {
  name: string;
  bio?: string;
  avatarUrl?: string;
  interests?: string | string[];
  actions?: ReactNode;
  accessibleName?: string;
  official?: boolean;
  headingAs?: 'h1' | 'h2';
  meta?: ReactNode;
  details?: Array<{ label: string; value: string }>;
};

export function SocialIdentity({
  name,
  bio,
  avatarUrl,
  interests,
  actions,
  accessibleName = `${name}的主页`,
  official = false,
  headingAs: Heading = 'h1',
  meta,
  details = [],
}: SocialIdentityProps) {
  const [failedAvatar, setFailedAvatar] = useState('');
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const visibleDetails = details.filter((detail) => detail.value.trim());
  const hasDetails = visibleDetails.length > 0;
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
      <div className="elsewhere-identity-orbit" aria-hidden="true">
        <svg viewBox="0 0 560 340" fill="none">
          <ellipse
            cx="320"
            cy="170"
            rx="244"
            ry="112"
            transform="rotate(-32 320 170)"
          />
          <ellipse
            cx="320"
            cy="170"
            rx="244"
            ry="112"
            transform="rotate(32 320 170)"
          />
        </svg>
      </div>
      <div className="elsewhere-identity-brand">
        <BrandLogo inverse />
        {official && (
          <span className="elsewhere-identity-official">
            <BadgeCheck size={15} /> 官方 Agent
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
            <UserRound size={25} strokeWidth={1.25} />
          )}
        </span>
        <div className="elsewhere-identity-copy">
          <Heading>{name}</Heading>
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
                  {showingDetails ? '返回身份' : '关于我'}
                  {showingDetails ? (
                    <ArrowDownLeft size={16} aria-hidden="true" />
                  ) : (
                    <ArrowUpRight size={16} aria-hidden="true" />
                  )}
                </button>
              )}
              {actions}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
