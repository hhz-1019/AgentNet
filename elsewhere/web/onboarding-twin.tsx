import { feedbackMessage } from './feedback-message';
import { ErrorBox } from './shared';
import { ContentState } from './recovery';
import { useEffect, useRef, useState } from 'react';
import { BrandLogo } from './brand';
import { api, ApiError } from './api';
import { isPortraitAvatar } from './default-avatars';
import { Login } from './auth';
import { AuthScene } from './auth-scene';
import {
  prefillCompanion,
  type CompanionSettings,
  type CompanionResponse,
} from './companion';
import { prefillPortrait } from './onboarding-prefill';
import type { Session, DraftResponse } from './types';
import { PortraitEditor } from './social/portrait';
import type { Portrait } from './social/portrait-data';
import {
  loadPortrait,
  writePortrait,
  type SavedPortrait,
} from './social/portrait-api';
import './social/editorial.css';
import './twin.css';
import { useRegistrationTracking } from './registration-tracking';
import { registrationProfileIssue } from './registration-profile';

export function Onboard({
  session,
  done,
}: {
  session: Session;
  done: () => void;
  accountReceipt?: { uid: string; recovery_key: string } | null;
}) {
  useEffect(() => {
    sessionStorage.removeItem('elsewhere:new-account');
  }, []);
  const content = (
    <main
      className={`onboarding twin-onboarding${!session.owner_bound ? ' auth-registration' : ''}`}
    >
      <a className="brand" href="/">
        <BrandLogo />
      </a>
      {!session.owner_uid && (
        <ol className="steps">
          <li className={!session.owner_bound ? 'current' : ''}>1. 注册账号</li>
          <li className={session.owner_bound ? 'current' : ''}>2. 确认资料</li>
        </ol>
      )}
      {!session.owner_bound ? (
        <Login binding initialUID={session.owner_uid} done={done} />
      ) : (
        <Confirm key={session.agent_id} session={session} done={done} />
      )}
    </main>
  );
  return session.owner_bound ? content : <AuthScene>{content}</AuthScene>;
}
function Confirm({ session, done }: { session: Session; done: () => void }) {
  useRegistrationTracking(true, 'profile');
  const [profile, setProfile] = useState<SavedPortrait>();
  const [companion, setCompanion] = useState<CompanionSettings>();
  const base = useRef<SavedPortrait | undefined>(undefined);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([
      loadPortrait(),
      api<DraftResponse>('agents/me/onboarding-draft'),
      api<CompanionResponse>('console/companion'),
    ])
      .then(([saved, response, settings]) => {
        if (!active) return;
        base.current = saved;
        const initial = prefillPortrait(
          saved,
          response.draft.data,
          session.agent_name,
        );
        const prepared = prefillCompanion(
          settings.settings,
          response.draft.data,
        );
        setProfile({
          ...initial,
          fields: {
            ...initial.fields,
            connections: prepared.connection_goal,
          },
        });
        setCompanion(prepared);
        setError('');
      })
      .catch((e: unknown) => {
        if (active) setError(feedbackMessage(e, '资料载入失败'));
      });
    return () => {
      active = false;
    };
  }, [attempt, session.agent_name]);
  // An already-open registration form must see late Agent artwork without
  // reloading the form or replacing the owner's text and preferences.
  useEffect(() => {
    if (!profile || profile.revision || isPortraitAvatar(profile.fields.avatar))
      return;
    let active = true;
    let reading = false;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => void readAvatar(),
        Math.min(30_000, 5_000 * 2 ** failures),
      );
    };
    async function readAvatar() {
      if (!active || stopped || reading) return;
      if (document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      reading = true;
      try {
        const response = await api<DraftResponse>('agents/me/onboarding-draft');
        if (!active) return;
        const avatar = prefillPortrait(
          profile!,
          response.draft.data,
          session.agent_name,
        ).fields.avatar;
        failures = 0;
        if (isPortraitAvatar(avatar)) {
          setProfile((current) =>
            current &&
            !current.revision &&
            !isPortraitAvatar(current.fields.avatar)
              ? { ...current, fields: { ...current.fields, avatar } }
              : current,
          );
          return;
        }
      } catch (error) {
        // Keep inputs and the last image; authorization failures stop this read.
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          stopped = true;
          return;
        }
        failures = Math.min(failures + 1, 3);
      } finally {
        reading = false;
      }
      if (active) schedule();
    }
    const resume = () => {
      if (document.visibilityState !== 'hidden') {
        clearTimeout(timer);
        void readAvatar();
      }
    };
    schedule();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [profile, session.agent_name]);
  async function save(next: Portrait) {
    if (!base.current) throw new Error('资料尚未载入');
    if (!agreed) throw new Error('请先勾选用户协议和 Agent 活动授权。');
    if (!companion) throw new Error('伙伴设置尚未载入');
    const issue = registrationProfileIssue(next.fields, companion.agent_name);
    if (issue) throw new Error(issue);
    const settings = await api<CompanionSettings>(
      'console/companion',
      {
        ...companion,
        connection_goal: (next.fields.connections || '').trim(),
      },
      'PUT',
    );
    setCompanion(settings);
    const saved = await writePortrait(base.current, next);
    base.current = saved;
    setProfile(saved);
  }
  async function complete() {
    try {
      if (!agreed) throw new Error('请先勾选用户协议和 Agent 活动授权。');
      await api('console/portrait/confirm', {
        revision: base.current?.revision,
        agreed,
      });
      history.replaceState(null, '', '/dashboard');
      done();
    } catch (e) {
      setError(feedbackMessage(e, '确认失败，请重试'));
    }
  }
  return (
    <>
      {error && (
        <ErrorBox
          error={error}
          retry={!profile ? () => retry((n) => n + 1) : undefined}
        />
      )}
      {!profile ? (
        !error && <ContentState title="正在打开资料" loading />
      ) : (
        <PortraitEditor
          profile={profile}
          companion={companion}
          onCompanionChange={setCompanion}
          onSave={save}
          onPublicHome={() => {}}
          onComplete={() => {
            void complete();
          }}
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
      )}
    </>
  );
}
