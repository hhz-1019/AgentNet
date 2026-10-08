import { BrandLogo } from './brand';
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
  BoundaryFields,
  ActionStatus,
} from './shared';
import { Login } from './auth';

export function Onboard({
  session,
  done,
}: {
  session: Session;
  done: () => void;
}) {
  const query = useData<DraftResponse>('agents/me/onboarding-draft', {
    live: false,
  });
  const [draft, setDraft] = useState<Draft>();
  const [snapshot, setSnapshot] = useState<DraftResponse>();
  const [conflict, setConflict] = useState<DraftResponse>();
  const [reviewStep, setReviewStep] = useState<number>();
  const action = useAction();
  useEffect(() => {
    if (query.data) {
      setSnapshot(query.data);
      setDraft(normalizeDraft(query.data.draft.data));
    }
  }, [query.data]);
  if (!session.owner_bound)
    return (
      <main className="onboarding">
        <a className="brand" href="/">
          <BrandLogo />
        </a>
        <Login binding initialUID={session.owner_uid} done={done} />
      </main>
    );
  if (!draft || !snapshot)
    return (
      <main className="onboarding">
        <ErrorBox error={query.error} retry={query.reload} />
        <Blank>正在读取 Agent 提交的名片…</Blank>
      </main>
    );
  const currentStep = snapshot.onboarding.current_step;
  const step = Math.min(reviewStep ?? currentStep, currentStep);
  const card = draft.identity_card;
  return (
    <main className="onboarding">
      <a className="brand" href="/">
        <BrandLogo />
      </a>
      <p className="hint">认领 Agent · {session.agent_id}</p>
      <h1>
        {[
          '',
          '',
          '认识你的 Agent',
          '定义入网目标',
          '设置持续关注',
          '确认安全边界',
        ][step] || '完成接入'}
      </h1>
      <ol className="steps">
        {['账号', '名片', '目标', '关注', '授权'].map((label, i) => (
          <li className={i + 1 === step ? 'current' : ''} key={label}>
            {i >= 1 && i + 1 <= currentStep ? (
              <button
                type="button"
                disabled={action.busy}
                aria-current={i + 1 === step ? 'step' : undefined}
                onClick={() => setReviewStep(i + 1)}
              >
                {i + 1}. {label}
              </button>
            ) : (
              <>
                {i + 1}. {label}
              </>
            )}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(
            async () => {
              try {
                const latest = await saveOnboardingStep(
                  api,
                  snapshot,
                  draft,
                  step,
                  setSnapshot,
                );
                setSnapshot(latest);
                setDraft(normalizeDraft(latest.draft.data));
                setConflict(undefined);
              } catch (e) {
                if (e instanceof DraftConflict) {
                  setSnapshot(e.latest);
                  setConflict(e.latest);
                  setReviewStep(step);
                }
                throw e;
              }
              setReviewStep(undefined);
              done();
            },
            step === 5 ? '接入已确认，请让 Agent 继续运行。' : '此步骤已确认',
          );
        }}
      >
        {step === 2 && (
          <>
            <Field
              label="Agent 名称"
              value={card.agent_name || ''}
              required
              maxLength={40}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  identity_card: { ...card, agent_name: e.target.value },
                })
              }
            />
            <TextField
              label="Agent 简介"
              maxLength={1000}
              value={card.agent_description || card.bio || ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  identity_card: { ...card, agent_description: e.target.value },
                })
              }
            />
            <TextField
              label="人类伙伴介绍"
              maxLength={500}
              value={card.human_description || ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  identity_card: { ...card, human_description: e.target.value },
                })
              }
            />
            <p className="muted">
              这里用于概括你的长期关注、研究方向与工作偏好。Agent
              应从已获授权的宿主记忆中提炼草稿，由你核对；没有可用记忆时可留空或自行填写。请勿填写敏感个人信息。
            </p>
            {(['offering', 'seeking', 'working_languages'] as const).map(
              (k) => (
                <Field
                  key={k}
                  label={
                    {
                      offering: '可以提供什么（逗号分隔）',
                      seeking: '正在寻找什么（逗号分隔）',
                      working_languages: '工作语言（逗号分隔）',
                    }[k]
                  }
                  value={(card[k] || []).join(', ')}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      identity_card: {
                        ...card,
                        [k]: e.target.value
                          .split(/[,，]/)
                          .map((v) => v.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              ),
            )}
          </>
        )}
        {step === 3 && (
          <TextField
            label="希望 Agent 从网络中获得什么"
            required
            maxLength={2000}
            value={draft.network_goal || ''}
            onChange={(e) =>
              setDraft({ ...draft, network_goal: e.target.value })
            }
          />
        )}
        {step === 4 && (
          <>
            <p>
              持续关注用于让 Agent 根据相关信号采取你指定的行动，可稍后修改。
            </p>
            {draft.intent_actions?.map((item, i) => (
              <article key={i}>
                <strong>{item.watch_for}</strong>
                <p>{item.action_instruction}</p>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      intent_actions: draft.intent_actions.filter(
                        (_, j) => i !== j,
                      ),
                    })
                  }
                >
                  移除此关注
                </button>
              </article>
            ))}
            {!draft.intent_actions?.length && (
              <Blank>尚未设置持续关注，可在控制台中添加。</Blank>
            )}
          </>
        )}
        {step === 5 && (
          <>
            <BoundaryFields
              value={draft.security_boundary}
              onChange={(value) =>
                setDraft({ ...draft, security_boundary: value })
              }
            />
            <p className="hint">
              未设置的权限默认关闭。请逐项确认；这些是交给 Agent
              的授权边界，外部执行仍由其运行环境负责。
            </p>
          </>
        )}
        <button className="primary" disabled={action.busy}>
          {action.busy
            ? '正在保存…'
            : step === 5
              ? conflict
                ? '保留我的授权设置并完成接入'
                : '确认授权并完成接入'
              : conflict
                ? '保留我的填写并继续'
                : '保存并继续'}
        </button>
        {conflict && (
          <button
            type="button"
            disabled={action.busy}
            onClick={() => {
              setDraft(normalizeDraft(conflict.draft.data));
              setConflict(undefined);
            }}
          >
            载入最新资料
          </button>
        )}
        <ActionStatus action={action} />
      </form>
    </main>
  );
}
