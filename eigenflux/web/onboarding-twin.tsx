import { useEffect, useRef, useState } from 'react';
import { BrandLogo } from './brand';
import { api } from './api';
import { Login } from './auth';
import { normalizeDraft } from './onboarding';
import { normalizeTwin } from './twin';
import type { TwinProfile } from './twin';
import type { Session, DraftResponse, Draft } from './types';
import { PortraitEditor } from './social/portrait';
import type { Portrait } from './social/portrait-data';
import {
  loadPortrait,
  writePortrait,
  type SavedPortrait,
} from './social/portrait-api';
import './social/editorial.css';
import './twin.css';

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
  return (
    <main className="onboarding twin-onboarding">
      <a className="brand" href="/">
        <BrandLogo />
      </a>
      <ol className="steps">
        <li className={!session.owner_bound ? 'current' : ''}>1. 注册账号</li>
        <li className={session.owner_bound ? 'current' : ''}>2. 确认画像</li>
      </ol>
      {!session.owner_bound ? (
        <Login binding initialUID={session.owner_uid} done={done} />
      ) : (
        <Confirm key={session.agent_id} session={session} done={done} />
      )}
    </main>
  );
}
function Confirm({ session, done }: { session: Session; done: () => void }) {
  const [profile, setProfile] = useState<SavedPortrait>();
  const base = useRef<SavedPortrait | undefined>(undefined);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([
      loadPortrait(),
      api<DraftResponse>('agents/me/onboarding-draft'),
    ])
      .then(([saved, response]) => {
        if (!active) return;
        base.current = saved;
        const draft = normalizeDraft(response.draft.data);
        const twin = normalizeTwin(
          (draft as Draft & { twin_profile?: Partial<TwinProfile> })
            .twin_profile,
        );
        const initial: SavedPortrait = saved.revision
          ? saved
          : {
              ...saved,
              fields: {
                ...saved.fields,
                name:
                  saved.fields.name ||
                  twin.name ||
                  draft.identity_card.agent_name ||
                  session.agent_name,
                bio:
                  saved.fields.bio ||
                  draft.identity_card.agent_description ||
                  '',
                interests:
                  saved.fields.interests || twin.basic_info.interests || '',
                role: saved.fields.role || twin.basic_info.role || '',
                recent: saved.fields.recent || twin.current_goal || '',
              },
              memories: saved.memories.length
                ? saved.memories
                : twin.episodes.map((m) => ({
                    id: m.id,
                    content: m.content,
                    showOnHome: false,
                    source: 'self' as const,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  })),
            };
        const prefill = (
          draft as Draft & { twin_profile?: { portrait?: Partial<Portrait> } }
        ).twin_profile?.portrait;
        if (!saved.revision && prefill) {
          for (const key of Object.keys(
            initial.fields,
          ) as (keyof Portrait['fields'])[]) {
            const value = prefill.fields?.[key];
            if (typeof value === 'string') initial.fields[key] = value;
          }
          if (!saved.memories.length && Array.isArray(prefill.memories))
            initial.memories = prefill.memories.map((m) => ({
              ...m,
              showOnHome: false,
              source: 'self',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }));
        }
        setProfile(initial);
        setError('');
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : '资料载入失败');
      });
    return () => {
      active = false;
    };
  }, [attempt, session.agent_name]);
  async function save(next: Portrait) {
    if (!base.current) throw new Error('资料尚未载入');
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
      setError(e instanceof Error ? e.message : '确认失败，请重试');
    }
  }
  return (
    <>
      <p>账号 UID：{session.owner_uid}</p>
      <p>Agent 根据已知信息准备了初版，请核对并修改。未提供的内容保持空白。</p>
      <label>
        接入应用
        <input
          readOnly
          disabled
          value={
            [session.runtime_name, session.runtime_version]
              .filter(Boolean)
              .join(' ') || 'Agent'
          }
        />
      </label>
      {error && (
        <p role="alert">
          {error}{' '}
          {!profile && (
            <button onClick={() => retry((n) => n + 1)}>重试</button>
          )}
        </p>
      )}
      {!profile ? (
        <p>正在读取资料…</p>
      ) : (
        <>
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
              ，每日活动上限可在设置中修改。
            </span>
          </label>
          <PortraitEditor
            profile={profile}
            onSave={save}
            onPublicHome={() => {}}
            onComplete={() => {
              void complete();
            }}
          />
        </>
      )}
    </>
  );
}
