import { feedbackMessage } from '../feedback-message';
import {
  isPortraitAvatar,
  isDefaultAvatar,
  suggestAvatar,
  avatarUrl,
} from '../default-avatars';
import { registrationProfileIssue } from '../registration-profile';
import { api } from '../api';
import type { CompanionSettings } from '../companion';
import { CompanionPreferences } from '../companion-view';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Eye } from '../icons';
import {
  portraitFields,
  type Portrait,
  type PortraitField,
} from './portrait-data';
import { mergeLegacyPortrait } from '../portrait-merge';
import './profile-design.css';

export function PortraitEditor({
  profile,
  onSave,
  onPublicHome,
  onComplete,
  beforeActions,
  companion,
  onCompanionChange,
  preview = false,
  previewAvatar,
}: {
  profile: Portrait;
  onSave: (p: Portrait) => void | Promise<void>;
  onPublicHome: () => void;
  focusMemory?: boolean;
  onComplete?: () => void;
  beforeActions?: ReactNode;
  companion?: CompanionSettings;
  onCompanionChange?: (settings: CompanionSettings) => void;
  preview?: boolean;
  previewAvatar?: string;
}) {
  const formId = useId();
  const mergedProfile = mergeLegacyPortrait(profile);
  const [fields, setFields] = useState(() => ({
    ...mergedProfile.fields,
    avatar: isPortraitAvatar(profile.fields.avatar)
      ? profile.fields.avatar
      : onComplete
        ? suggestAvatar(profile.fields)
        : '',
  }));
  const [avatarPreview, setAvatarPreview] = useState('');
  const uploadInput = useRef<HTMLInputElement>(null);
  const avatarChosen = useRef(false);
  useEffect(() => {
    const preparedAvatar = profile.fields.avatar;
    if (!avatarChosen.current && isPortraitAvatar(preparedAvatar)) {
      setFields((current) =>
        current.avatar !== preparedAvatar
          ? { ...current, avatar: preparedAvatar }
          : current,
      );
    }
  }, [profile.fields.avatar]);
  useEffect(
    () => () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    },
    [avatarPreview],
  );
  const [visible, setVisible] = useState(mergedProfile.visible);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  async function save(next: Portrait, message: string) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    try {
      await onSave(next);
      setError('');
      setStatus(message);
      return true;
    } catch (e) {
      setError(feedbackMessage(e, '保存失败，输入已保留，请重试。'));
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function changeField(key: PortraitField, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setStatus('');
    setError('');
  }
  return (
    <section className="sn-portrait">
      <header className="sn-page-heading">
        <div>
          <h1>{onComplete ? '确认资料' : '编辑资料'}</h1>
        </div>
        {!onComplete && (
          <button onClick={onPublicHome}>
            查看主页 <ArrowRight size={16} />
          </button>
        )}
      </header>
      <section className="sn-portrait-details" aria-label="资料">
        <form
          id={formId}
          className="sn-portrait-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!(companion ? companion.agent_name : fields.name).trim())
              return;
            if (onComplete) {
              const issue = registrationProfileIssue(
                fields,
                companion?.agent_name || fields.name,
              );
              if (issue) {
                setError(issue);
                setStatus('');
                return;
              }
            }
            const saved = await save(
              {
                ...profile,
                fields: { ...fields, name: fields.name.trim() },
                visible,
              },
              '资料已保存。',
            );
            if (saved) onComplete?.();
          }}
        >
          <fieldset
            className="ew-avatar-picker ew-personal-avatar"
            disabled={busy}
          >
            <legend>Agent 的头像</legend>
            <div className="ew-personal-avatar-row">
              <img
                className="ew-avatar-image"
                src={
                  avatarPreview ||
                  (preview ? previewAvatar : '') ||
                  avatarUrl(fields.avatar, companion?.agent_name || fields.name)
                }
                alt="Agent 头像"
                width={96}
                height={96}
              />
              <div>
                {isDefaultAvatar(fields.avatar) &&
                  !(preview && previewAvatar) && (
                    <span className="sn-avatar-kind">默认头像</span>
                  )}
                <input
                  ref={uploadInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label="上传 Agent 头像"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    if (file.size > 8 * 1024 * 1024) {
                      setError('头像需为不超过 8 MB 的 PNG/JPEG。');
                      return;
                    }
                    avatarChosen.current = true;
                    setBusy(true);
                    setError('');
                    try {
                      if (preview) {
                        setAvatarPreview(URL.createObjectURL(file));
                        setStatus('预览头像已替换，不会上传到真实账号。');
                      } else {
                        const data = await new Promise<string>(
                          (resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                              if (typeof reader.result !== 'string') {
                                reject(new Error('图片读取失败'));
                                return;
                              }
                              resolve(reader.result.split(',')[1]);
                            };
                            reader.onerror = () =>
                              reject(new Error('图片读取失败'));
                            reader.readAsDataURL(file);
                          },
                        );
                        const result = await api<{ avatar: string }>(
                          'console/portrait/avatar',
                          { data },
                          'POST',
                        );
                        setFields((current) => ({
                          ...current,
                          avatar: result.avatar,
                        }));
                        setStatus('头像已准备，保存资料后生效。');
                      }
                    } catch (e) {
                      setError(feedbackMessage(e, '头像上传失败'));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => uploadInput.current?.click()}
                >
                  上传替换
                </button>
              </div>
            </div>
          </fieldset>
          <div className="sn-portrait-grid">
            {portraitFields.map((originalField) => {
              const field = companion
                ? {
                    ...originalField,
                    label:
                      originalField.key === 'name'
                        ? 'Agent 的名字'
                        : originalField.label,
                  }
                : originalField;
              return (
                <div
                  className={`sn-portrait-field sn-portrait-field-${field.key}`}
                  key={field.key}
                >
                  <div>
                    <label htmlFor={`${formId}-${field.key}`}>
                      {field.label}
                      {(field.key === 'name' || onComplete) && (
                        <span className="required-mark" aria-hidden="true">
                          {' '}
                          *
                        </span>
                      )}
                    </label>
                    {field.key === 'name' ? (
                      <span className="sn-visibility sn-visibility-fixed">
                        <Eye size={16} aria-hidden="true" /> 固定展示
                      </span>
                    ) : (
                      <label className="sn-visibility">
                        <input
                          type="checkbox"
                          aria-label={`${field.label}在主页展示`}
                          checked={visible.includes(field.key)}
                          onChange={(e) => {
                            setVisible((v) =>
                              e.target.checked
                                ? [...v, field.key]
                                : v.filter((key) => key !== field.key),
                            );
                            setStatus('');
                          }}
                        />
                        主页展示
                      </label>
                    )}
                  </div>
                  {field.key === 'name' ? (
                    <input
                      id={`${formId}-${field.key}`}
                      aria-label={field.label}
                      required={field.key === 'name'}
                      maxLength={companion ? 40 : 80}
                      value={
                        field.key === 'name' && companion
                          ? companion.agent_name
                          : fields[field.key]
                      }
                      onChange={(e) =>
                        field.key === 'name' && companion && onCompanionChange
                          ? onCompanionChange({
                              ...companion,
                              agent_name: e.target.value,
                            })
                          : changeField(field.key, e.target.value)
                      }
                    />
                  ) : (
                    <textarea
                      id={`${formId}-${field.key}`}
                      aria-label={field.label}
                      required={!!onComplete}
                      rows={3}
                      maxLength={
                        {
                          bio: 600,
                          interests: 800,
                          offers: 800,
                          connections: 1000,
                        }[field.key]
                      }
                      value={fields[field.key] || ''}
                      onChange={(e) => changeField(field.key, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {companion && onCompanionChange && (
            <CompanionPreferences
              value={companion}
              onChange={onCompanionChange}
            />
          )}
        </form>
        {!onComplete && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const archive = preview
                  ? {
                      schema: 'elsewhere.legacy-profile.v1',
                      portrait_memories: profile.memories,
                    }
                  : await api<unknown>('console/portrait/export');
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(archive, null, 2)], {
                    type: 'application/json',
                  }),
                );
                const a = document.createElement('a');
                a.href = url;
                a.download = 'elsewhere-旧资料.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (e) {
                setError(feedbackMessage(e, '导出未完成，请重试。'));
              } finally {
                setBusy(false);
              }
            }}
          >
            导出旧资料
          </button>
        )}
      </section>
      {status && (
        <output className="sn-portrait-status" aria-live="polite">
          {status}
        </output>
      )}
      {error && (
        <p role="alert" className="sw-error">
          {error}
        </p>
      )}
      {beforeActions}
      <div
        className={
          onComplete ? 'portrait-confirm-actions' : 'sn-portrait-actions'
        }
      >
        <button
          className="sw-primary"
          type="submit"
          form={formId}
          disabled={
            busy || !(companion ? companion.agent_name : fields.name).trim()
          }
        >
          {onComplete ? '确认资料，进入 elsewhere' : '保存资料'}
        </button>
      </div>
    </section>
  );
}
