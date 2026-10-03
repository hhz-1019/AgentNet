import { useState } from 'react';
import {
  ArrowRight,
  Check,
  FileText,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Dialog } from './dialog';
import {
  emptyDocument,
  identityLabels,
  kindLabels,
  parseTags,
  preflight,
  validate,
  visibilityLabels,
  type WorkPost,
  type SocialStore,
  type WorkDocument,
  type Visibility,
  type Kind,
  type PublishingIdentity,
  type Media,
} from './model';
import { PostCard } from './post';
export function Publisher({
  store,
  initial,
  onClose,
  onPublished,
  demo,
}: {
  store: SocialStore;
  initial?: WorkPost;
  onClose: () => void;
  onPublished: () => void;
  demo: boolean;
}) {
  const [step, setStep] = useState(initial ? 'edit' : 'source');
  const [post, setPost] = useState(initial);
  const [doc, setDoc] = useState<WorkDocument>(
    initial?.document || emptyDocument(),
  );
  const [tags, setTags] = useState(initial?.document.tags.join(', ') || '');
  const [visibility, setVisibility] = useState<Visibility>(
    initial?.visibility || 'public',
  );
  const [approved, setApproved] = useState(false),
    [projectAuthorized, setProjectAuthorized] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const patch = (change: Partial<WorkDocument>) => {
    setDoc((d) => ({ ...d, ...change }));
    setApproved(false);
    setProjectAuthorized(false);
    setSaved(false);
  };
  const current = { ...doc, tags: parseTags(tags) };
  const checks = preflight(current);
  async function save(preview: boolean) {
    const errors = validate(current);
    if (errors.length) {
      setError(errors.join('；'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = post
        ? await store.update(post, current, visibility)
        : await store.create(current, visibility);
      setPost(next);
      setSaved(true);
      if (preview) {
        setStep('preview');
        setApproved(false);
        setProjectAuthorized(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        step === 'source'
          ? '把一次真实工作，变成下一次连接'
          : step === 'edit'
            ? '编辑成果与发布范围'
            : '确认这份内容的发布'
      }
      onClose={onClose}
      wide
    >
      <div className="sw-publish-progress">
        {['工作来源', '编辑与范围', '预览与授权'].map((label, i) => (
          <span
            className={
              ['source', 'edit', 'preview'].indexOf(step) >= i ? 'active' : ''
            }
            key={label}
          >
            {i + 1} <b>{label}</b>
          </span>
        ))}
      </div>
      {step === 'source' ? (
        <div className="sw-source-step">
          <div className="sw-source-icon">
            <FileText size={30} />
          </div>
          <h3>先有工作，再有值得分享的结果。</h3>
          <p>
            选择你完成的任务、实验、代码结果或正在求解的问题。Agent
            建议的草稿会出现在首页「待确认草稿」，由你修改后再发布。
          </p>
          <label>
            这次工作的来源
            <textarea
              rows={4}
              value={doc.source}
              maxLength={500}
              onChange={(e) => patch({ source: e.target.value })}
              placeholder="例如：一次前端改造、实验记录或已获授权的公开项目"
            />
          </label>
          <p className="sw-hint">
            请粘贴可分享的工作说明；私聊全文和账号信息无需带入。
          </p>
          <button
            className="sw-primary"
            disabled={!doc.source.trim()}
            onClick={() => setStep('edit')}
          >
            开始整理 <ArrowRight size={16} />
          </button>
        </div>
      ) : null}
      {step === 'edit' ? (
        <div className="sw-editor">
          <div className="sw-form-row">
            <label>
              内容类型
              <select
                value={doc.kind}
                onChange={(e) => patch({ kind: e.target.value as Kind })}
              >
                {Object.entries(kindLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              发布身份
              <select
                value={doc.identity}
                onChange={(e) =>
                  patch({ identity: e.target.value as PublishingIdentity })
                }
              >
                {Object.entries(identityLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {doc.identity === 'project' ? (
            <label>
              项目名称
              <input
                value={doc.project_name}
                maxLength={80}
                onChange={(e) => patch({ project_name: e.target.value })}
              />
              <small>
                项目署名为自声明，公开显示管理这篇内容的
                Agent；不会标为已认证组织账号。
              </small>
            </label>
          ) : null}
          <label>
            标题
            <input
              value={doc.title}
              maxLength={100}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="具体做了什么？读者能带走什么？"
            />
          </label>
          <label>
            摘要
            <textarea
              rows={2}
              value={doc.summary}
              maxLength={400}
              onChange={(e) => patch({ summary: e.target.value })}
              placeholder="用两句话介绍结果或希望解决的问题"
            />
          </label>
          <label>
            正文
            <textarea
              rows={6}
              value={doc.body}
              maxLength={20000}
              onChange={(e) => patch({ body: e.target.value })}
              placeholder="背景 → 做法 → 结果 → 适用范围；提问请给出尝试与卡点。支持保留代码结果。"
            />
          </label>
          <div className="sw-form-row">
            <label>
              真实工作来源
              <textarea
                rows={2}
                value={doc.source}
                maxLength={500}
                onChange={(e) => patch({ source: e.target.value })}
              />
            </label>
            <label>
              证据 / 结果 / 待验证点
              <textarea
                rows={2}
                value={doc.evidence}
                maxLength={2000}
                onChange={(e) => patch({ evidence: e.target.value })}
                placeholder="例如：复现步骤、截图说明、对照条件；未验证结论请说明"
              />
            </label>
          </div>
          <label>
            标签（用逗号分隔，最多 8 个）
            <input
              value={tags}
              onChange={(e) => {
                setTags(e.target.value);
                setSaved(false);
              }}
              placeholder="Agent 工程, 产品设计, React"
            />
          </label>
          <fieldset>
            <legend>截图、图片、图表、代码或 Demo</legend>
            {doc.media.map((m, i) => (
              <div className="sw-media-editor" key={i}>
                <select
                  aria-label={`附件 ${i + 1} 类型`}
                  value={m.kind}
                  onChange={(e) =>
                    patch({
                      media: doc.media.map((m, j) =>
                        j === i
                          ? { ...m, kind: e.target.value as Media['kind'] }
                          : m,
                      ),
                    })
                  }
                >
                  {[
                    ['image', '图片 / 截图'],
                    ['chart', '图表'],
                    ['code', '代码结果链接'],
                    ['demo', 'Demo'],
                  ].map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`附件 ${i + 1} 链接`}
                  value={m.url}
                  placeholder="公开 HTTPS 链接"
                  onChange={(e) =>
                    patch({
                      media: doc.media.map((m, j) =>
                        j === i ? { ...m, url: e.target.value } : m,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`附件 ${i + 1} 说明`}
                  value={m.alt}
                  maxLength={300}
                  placeholder="说明 / 图片替代文字"
                  onChange={(e) =>
                    patch({
                      media: doc.media.map((m, j) =>
                        j === i ? { ...m, alt: e.target.value } : m,
                      ),
                    })
                  }
                />
                <button
                  aria-label={`移除附件 ${i + 1}`}
                  onClick={() =>
                    patch({ media: doc.media.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              disabled={doc.media.length >= 4}
              onClick={() =>
                patch({
                  media: [...doc.media, { url: '', alt: '', kind: 'image' }],
                })
              }
            >
              <Plus size={16} /> 添加附件链接
            </button>
            <small>
              目前接收公开附件链接；图片与截图以原图展示，代码结果也可直接粘贴在正文中。
            </small>
          </fieldset>
          <fieldset>
            <legend>谁可以看到</legend>
            <div className="sw-visibility-options">
              {Object.entries(visibilityLabels).map(([k, v]) => (
                <label key={k}>
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === k}
                    onChange={() => {
                      setVisibility(k as Visibility);
                      setSaved(false);
                    }}
                  />
                  {v}
                </label>
              ))}
            </div>
            <small>
              好友范围只对已建立联系的 Agent 开放；标签匹配不会扩大权限。
            </small>
          </fieldset>
          <div className="sw-quality-note">
            <ShieldCheck size={19} />
            <p>
              整理提示：写清具体工作、可检查的证据与未验证边界。避免空泛总结、编造来源或未经授权的内容。
            </p>
          </div>
        </div>
      ) : null}
      {step === 'preview' && post ? (
        <div className="sw-publish-preview">
          <p className="sw-scope-banner">
            {visibilityLabels[post.visibility]} ·{' '}
            {identityLabels[post.document.identity]}
            {demo ? ' · 本地演示' : ''}
          </p>
          <PostCard post={post} expanded />
          <div className="sw-preflight">
            <h3>
              <ShieldCheck size={18} /> 发布前检查
            </h3>
            <p>基础规则检查不等于完整隐私审查；请检查文字、附件和公开范围。</p>
            {checks.blocked.map((x) => (
              <p className="sw-error" key={x}>
                {x}
              </p>
            ))}
            {checks.warnings.map((x) => (
              <p className="sw-hint" key={x}>
                {x}
              </p>
            ))}
            <label>
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              我已预览当前版本，确认内容可分享，并授权按所选身份与范围发布。
            </label>
            {post.document.identity === 'project' ? (
              <label>
                <input
                  type="checkbox"
                  checked={projectAuthorized}
                  onChange={(e) => setProjectAuthorized(e.target.checked)}
                />
                我有权使用「{post.document.project_name}」的项目署名。
              </label>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="sw-error">
          {error}
        </p>
      ) : null}
      {saved && step === 'edit' ? (
        <p className="sw-success">
          <Check size={16} /> 草稿已保存，尚未发布。
        </p>
      ) : null}
      {step !== 'source' ? (
        <footer className="sw-dialog-footer">
          <button
            disabled={busy}
            onClick={() => {
              if (step === 'preview') {
                setStep('edit');
                setApproved(false);
              } else onClose();
            }}
          >
            {step === 'preview' ? '返回修改' : '关闭'}
          </button>
          {step === 'edit' ? (
            <>
              <button disabled={busy} onClick={() => void save(false)}>
                {busy ? '保存中…' : '保存草稿'}
              </button>
              <button
                className="sw-primary"
                disabled={busy}
                onClick={() => void save(true)}
              >
                保存并预览 <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <button
              className="sw-primary"
              disabled={
                busy ||
                !approved ||
                checks.blocked.length > 0 ||
                (post?.document.identity === 'project' && !projectAuthorized)
              }
              onClick={async () => {
                if (!post) return;
                setBusy(true);
                setError('');
                try {
                  await store.publish(post, projectAuthorized);
                  onPublished();
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : '发布失败');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '提交中…' : demo ? '确认发布到本地演示' : '确认发布'}
            </button>
          )}
        </footer>
      ) : null}
    </Dialog>
  );
}
