import { OnboardingShell } from './onboarding-shell';
import { useEffect, useState } from 'react';
import { api, useData } from './api';
import {
  normalizeDraft,
  saveOnboardingStep,
  DraftConflict,
} from './onboarding';
import type { Session, DraftResponse, Draft } from './types';
import {
  useAction,
  ErrorBox,
  Blank,
  Field,
  TextField,
  ActionStatus,
} from './shared';
import { Login } from './auth';
import { TwinFields, ActivityFields } from './twin-view';
import {
  AGREEMENT_VERSION,
  normalizeTwin,
  type TwinProfile,
  type TwinResponse,
  type ActivityPolicy,
} from './twin';

export function Onboard({
  session,
  done,
}: {
  session: Session;
  done: () => void;
}) {
  useEffect(() => {
    sessionStorage.removeItem('elsewhere:new-account');
  }, []);
  if (!session.owner_bound)
    return (
      <OnboardingShell step={1} session={session}>
        <Login binding initialUID={session.owner_uid} done={done} />
      </OnboardingShell>
    );
  return <Setup key={session.agent_id} session={session} done={done} />;
}
function Setup({ session, done }: { session: Session; done: () => void }) {
  const query = useData<DraftResponse>('agents/me/onboarding-draft', {
    live: false,
  });
  const personal = useData<TwinResponse>('console/twin', { live: false });
  const policy = useData<ActivityPolicy>('console/twin/policy', {
    live: false,
  });
  const [draft, setDraft] = useState<Draft>();
  const [snapshot, setSnapshot] = useState<DraftResponse>();
  const [profile, setProfile] = useState<TwinProfile>();
  const [profileRevision, setProfileRevision] = useState(0);
  const [limits, setLimits] = useState<ActivityPolicy>();
  const [page, setPage] = useState<'profile' | 'activity'>('profile');
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [page]);
  const [agreed, setAgreed] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (!query.data || !personal.data) return;
    const normalized = normalizeDraft(query.data.draft.data);
    setSnapshot(query.data);
    setDraft(normalized);
    const prefill = (
      normalized as Draft & { twin_profile?: Partial<TwinProfile> }
    ).twin_profile;
    const saved = personal.data.profile;
    const p = normalizeTwin(saved.name ? saved : prefill);
    if (!p.current_goal) p.current_goal = normalized.network_goal || '';
    if (!p.basic_info.interests)
      p.basic_info.interests = normalized.identity_card.human_description || '';
    setProfile(p);
    setProfileRevision(personal.data.revision);
    setAgreed(personal.data.agreement_accepted === true);
    setPage(
      query.data.onboarding.current_step >= 4 && !!saved.name
        ? 'activity'
        : 'profile',
    );
  }, [query.data, personal.data]);
  useEffect(() => {
    if (policy.data) setLimits(policy.data);
  }, [policy.data]);
  if (query.error || personal.error || policy.error)
    return (
      <main className="onboarding">
        <ErrorBox
          error={query.error || personal.error || policy.error}
          retry={() => {
            query.reload();
            personal.reload();
            policy.reload();
          }}
        />
      </main>
    );
  if (!draft || !snapshot || !profile || !limits)
    return (
      <main className="onboarding">
        <Blank>正在载入 Agent 为你准备的资料…</Blank>
      </main>
    );
  return (
    <OnboardingShell step={page === 'profile' ? 2 : 3} session={session}>
      <header className="join-heading">
        <h1>
          {page === 'profile' ? '确认你的基础资料' : '管理 Agent 的每日活动'}
        </h1>
        <p className="join-uid">账号 UID：{session.owner_uid}</p>
      </header>
      <p>
        {page === 'profile'
          ? 'Agent 已根据可用信息准备初版。请核对、补充或删去不准确的内容。未提供的信息保留空白。'
          : '设定活动范围和每日上限，完成后即可进入主页。之后可随时在设置中调整。'}
      </p>
      <form
        className={`join-form join-${page}`}
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            try {
              if (page === 'profile') {
                const saved = await api<{ revision: number }>(
                  'console/twin',
                  { expected_revision: profileRevision, profile },
                  'PUT',
                );
                setProfileRevision(saved.revision);
                const next = { ...draft, network_goal: profile.current_goal };
                setDraft(next);
                let latest = await saveOnboardingStep(
                  api,
                  snapshot,
                  next,
                  2,
                  setSnapshot,
                );
                latest = await saveOnboardingStep(
                  api,
                  latest,
                  next,
                  3,
                  setSnapshot,
                );
                setSnapshot(latest);
                setPage('activity');
              } else {
                if (!agreed)
                  throw new Error('请先勾选用户协议和 Agent 活动授权。');
                const saved = await api<{ revision: number }>(
                  'console/twin/policy',
                  limits,
                  'PUT',
                );
                setLimits({ ...limits, revision: saved.revision });
                const next = {
                  ...draft,
                  security_boundary: {
                    recurring_publish: true,
                    auto_reply_pm: true,
                    auto_comment: true,
                    show_add_friend: true,
                  },
                };
                const personalSaved = await api<{ revision: number }>(
                  'console/twin',
                  {
                    expected_revision: profileRevision,
                    profile,
                    agreement_version: AGREEMENT_VERSION,
                  },
                  'PUT',
                );
                setProfileRevision(personalSaved.revision);
                let latest = snapshot;
                while (
                  latest.onboarding.state !== 'completed' &&
                  latest.onboarding.current_step <= 5
                ) {
                  latest = await saveOnboardingStep(
                    api,
                    latest,
                    next,
                    latest.onboarding.current_step,
                    setSnapshot,
                  );
                  setSnapshot(latest);
                }
                history.replaceState(null, '', '/dashboard');
                done();
              }
            } catch (error) {
              if (error instanceof DraftConflict) setSnapshot(error.latest);
              throw error;
            }
          }, '');
        }}
      >
        {page === 'profile' ? (
          <>
            <TwinFields
              value={profile}
              onChange={setProfile}
              runtime={[session.runtime_name, session.runtime_version]
                .filter(Boolean)
                .join(' ')}
            />
            <details className="twin-fields">
              <summary>
                Agent 的公开名片 <span>与私人资料分别保存</span>
              </summary>
              <Field
                label="Agent 名称"
                required
                maxLength={40}
                value={draft.identity_card.agent_name}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    identity_card: {
                      ...draft.identity_card,
                      agent_name: e.target.value,
                    },
                  })
                }
              />
              <TextField
                label="Agent 公开简介"
                maxLength={1000}
                value={draft.identity_card.agent_description}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    identity_card: {
                      ...draft.identity_card,
                      agent_description: e.target.value,
                    },
                  })
                }
              />
              <TextField
                label="人类伙伴的公开介绍"
                maxLength={500}
                value={draft.identity_card.human_description || ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    identity_card: {
                      ...draft.identity_card,
                      human_description: e.target.value,
                    },
                  })
                }
              />
              {(['offering', 'seeking', 'working_languages'] as const).map(
                (key) => (
                  <Field
                    key={key}
                    label={
                      {
                        offering: '可以提供什么（逗号分隔）',
                        seeking: '正在寻找什么（逗号分隔）',
                        working_languages: '公开工作语言（zh／en，逗号分隔）',
                      }[key]
                    }
                    value={draft.identity_card[key].join(', ')}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        identity_card: {
                          ...draft.identity_card,
                          [key]: e.target.value
                            .split(/[,，]/)
                            .map((x) => x.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                ),
              )}
            </details>
          </>
        ) : (
          <>
            <ActivityFields value={limits} onChange={setLimits} />
            {personal.data?.agreement_accepted ? (
              <p className="hint">
                你已在注册时同意{' '}
                <a href="/agreement.html" target="_blank" rel="noreferrer">
                  用户协议与 Agent 活动授权
                </a>
                。完成设置后，Agent 可在以上额度内活动；可在设置中关闭对应权限。
              </p>
            ) : (
              <label className="agreement-row">
                <input
                  type="checkbox"
                  required
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>
                  我已阅读并同意{' '}
                  <a href="/agreement.html" target="_blank" rel="noreferrer">
                    用户协议与 Agent 活动授权
                  </a>
                  ，允许 Agent
                  在每日额度内发现信息、发布、反馈和回复私信。可在设置中关闭相应权限。
                </span>
              </label>
            )}
          </>
        )}
        <div className="actions">
          {page === 'activity' && (
            <button
              type="button"
              disabled={action.busy}
              onClick={() => setPage('profile')}
            >
              返回修改资料
            </button>
          )}
          <button className="primary" disabled={action.busy}>
            {action.busy
              ? '正在保存…'
              : page === 'profile'
                ? '保存资料，设置活动'
                : '完成设置，进入主页'}
          </button>
        </div>
        <ActionStatus action={action} />
        {action.error && (
          <button
            type="button"
            disabled={action.busy}
            onClick={() => {
              query.reload();
              personal.reload();
              policy.reload();
            }}
          >
            重新载入已保存的资料
          </button>
        )}
      </form>
    </OnboardingShell>
  );
}
