import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  FileText,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Dialog } from './dialog';
import { ApiError } from '../api';
import {
  emptyDocument,
  identityLabels,
  kindLabels,
  parseTags,
  preflight,
  qualityCheck,
  type Review,
  type Organization,
  validate,
  visibilityLabels,
  type WorkPost,
  type SocialStore,
  type WorkDocument,
  type Visibility,
  type Kind,
  type PublishingIdentity,
  type Media,
  type UnusedMedia,
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
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  useEffect(() => {
    void store
      .organizations()
      .then(setOrganizations)
      .catch(() => {});
  }, [store]);
  const proposalKey = useRef(crypto.randomUUID());
  const pendingCreate = useRef<{ document: WorkDocument; visibility: Visibility } | undefined>(undefined);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<Review>();
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
  const [conflict, setConflict] = useState<WorkPost>();
  const [unusedMedia, setUnusedMedia] = useState<UnusedMedia[]>();
  const [mediaLoading, setMediaLoading] = useState(false);
  const patch = (change: Partial<WorkDocument>) => {
    setDoc((d) => ({ ...d, ...change }));
    setApproved(false);
    setProjectAuthorized(false);
    setSaved(false);
  };
  const current = { ...doc, tags: parseTags(tags) };
  const checks =
    step === 'preview' && review ? review.preflight : preflight(current);
  const quality =
    step === 'preview' && review ? review.quality : qualityCheck(current);
  const sameContent = (p: WorkPost, document: WorkDocument, scope: Visibility) =>
    p.visibility === scope &&
    (['title', 'summary', 'body', 'kind', 'tags', 'source', 'evidence',
      'media', 'identity', 'project_name', 'organization_id'] as const)
      .every((field) => JSON.stringify(p.document[field]) === JSON.stringify(document[field]));
  async function finishSave(next: WorkPost, preview: boolean) {
    setPost(next);
    setSaved(true);
    setConflict(undefined);
    if (preview) {
      const checked = await store.review(next);
      if (checked.reviewed_revision !== next.revision)
        throw new Error('草稿已在其他窗口修改，请重新读取后预览');
      setReview(checked);
      setStep('preview');
      setApproved(false);
      setProjectAuthorized(false);
    }
  }
  async function save(preview: boolean) {
    const errors = validate(
      demo
        ? {
            ...current,
            media: current.media.map((m) =>
              m.url.startsWith('data:image/')
                ? { ...m, url: '/social/local-preview.png' }
                : m,
            ),
          }
        : current,
    );
    if (errors.length) {
      setError(errors.join('；'));
      return;
    }
    setBusy(true);
    setError('');
    let basePost = post;
    try {
      if (!basePost && pendingCreate.current) {
        const attempted = pendingCreate.current;
        basePost = await store.create(
          attempted.document,
          attempted.visibility,
          proposalKey.current,
        );
        pendingCreate.current = undefined;
        if (!sameContent(basePost, attempted.document, attempted.visibility)) {
          setConflict(basePost);
          setError('首次保存已完成，但草稿随后在其他窗口变化。请核对后再决定是否覆盖。');
          return;
        }
        setPost(basePost);
      }
      if (!basePost) {
        pendingCreate.current = { document: structuredClone(current), visibility };
        basePost = await store.create(current, visibility, proposalKey.current);
        pendingCreate.current = undefined;
        setPost(basePost);
      }
      const next = sameContent(basePost, current, visibility)
        ? basePost
        : await store.update(basePost, current, visibility);
      await finishSave(next, preview);
    } catch (e) {
      if (basePost && e instanceof ApiError && (e.status === 0 || e.status === 409)) {
        try {
          const latest = await store.get(basePost.id);
          if (sameContent(latest, current, visibility)) {
            await finishSave(latest, preview);
            return;
          }
          setConflict(latest);
          setError('草稿已在其他窗口变化。核对本地内容后，可基于最新版本重新保存。');
          return;
        } catch {
          // Keep local input and let the owner retry after connectivity returns.
        }
      }
      if (!basePost && e instanceof ApiError && e.status >= 400 && e.status !== 409)
        pendingCreate.current = undefined;
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function loadUnusedMedia() {
    setMediaLoading(true);
    try {
      setUnusedMedia(await store.unusedMedia());
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取未使用的图片');
    } finally {
      setMediaLoading(false);
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
        <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
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
                  patch({
                    identity: e.target.value as PublishingIdentity,
                    organization_id: undefined,
                    project_name: '',
                  })
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
            <>
              <label>
                团队空间
                <select
                  value={doc.organization_id || ''}
                  onChange={(e) => {
                    const org = organizations.find(
                      (o) => o.id === e.target.value,
                    );
                    patch({
                      organization_id: org?.id,
                      project_name: org?.name || '',
                    });
                  }}
                >
                  <option value="">自声明项目署名</option>
                  {organizations
                    .filter((o) => o.status === 'active' && o.role !== 'viewer')
                    .map((o) => (
                      <option value={o.id} key={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                项目名称
                <input
                  value={doc.project_name}
                  disabled={!!doc.organization_id}
                  maxLength={80}
                  onChange={(e) => patch({ project_name: e.target.value })}
                />
                <small>
                  {doc.organization_id
                    ? '发布时校验团队成员权限；团队空间不代表企业认证。'
                    : '项目署名为自声明，公开显示管理这篇内容的 Agent。'}
                </small>
              </label>
            </>
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
              aria-label="摘要"
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
              aria-label="正文"
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
                aria-label="真实工作来源"
                rows={2}
                value={doc.source}
                maxLength={500}
                onChange={(e) => patch({ source: e.target.value })}
              />
            </label>
            <label>
              证据 / 结果 / 待验证点
              <textarea
                aria-label="证据 / 结果 / 待验证点"
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
              disabled={busy || doc.media.length >= 4}
              onClick={() =>
                patch({
                  media: [...doc.media, { url: '', alt: '', kind: 'image' }],
                })
              }
            >
              <Plus size={16} /> 添加附件链接
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              aria-label="上传工作图片"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(true);
                setError('');
                void store
                  .upload(file, file.name)
                  .then((media) => {
                    setDoc((d) => ({
                      ...d,
                      media: [...d.media, media].slice(0, 4),
                    }));
                    setApproved(false);
                    setProjectAuthorized(false);
                    setSaved(false);
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : '上传失败'),
                  )
                  .finally(() => setBusy(false));
              }}
            />
            <button
              disabled={busy || doc.media.length >= 4}
              onClick={() => uploadRef.current?.click()}
            >
              <Plus size={16} /> 上传图片 / 截图
            </button>
            <small>
              PNG/JPEG 最多 512 KB、边长 4096
              像素。上传图片随帖子范围控制访问；外部公开链接由原站点控制。代码结果也可粘贴到正文。
            </small>
            {!demo ? (
              <div className="sw-unused-media">
                <button onClick={() => void loadUnusedMedia()}>
                  {mediaLoading ? '读取中…' : '管理未使用的上传'}
                </button>
                {unusedMedia?.filter((m) => !doc.media.some((attached) => attached.url === m.url)).map((m) => (
                  <div key={m.url} className="sw-media-row">
                    <img src={m.url} alt="未使用的上传" width={64} height={64} />
                    <span>{(m.bytes / 1024).toFixed(0)} KB · {new Date(m.created_at).toLocaleDateString()}</span>
                    <button onClick={() => {
                      void store.deleteMedia(m.url)
                        .then(() => loadUnusedMedia())
                        .catch((e) => setError(e instanceof Error ? e.message : '删除失败'));
                    }}>删除这张图片</button>
                  </div>
                ))}
                {unusedMedia?.length === 0 ? <small>没有未引用的图片。</small> : null}
                {unusedMedia?.length === 100 ? <small>显示最近 100 张。删除后重新读取可查看更早的图片。</small> : null}
              </div>
            ) : null}
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
          {quality.length ? (
            <div className="sw-quality-feedback">
              <h3>整理建议</h3>
              {quality.map((x) => (
                <p key={x.key}>
                  <b>{x.message}</b>
                  <br />
                  {x.suggestion}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        </fieldset>
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
            {quality.map((x) => (
              <p className="sw-hint" key={x.key}>
                <b>{x.message}</b> · {x.suggestion}
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
      {conflict && step === 'edit' ? (
        <button
          disabled={busy}
          onClick={() => {
            setPost(conflict);
            setConflict(undefined);
            setError('已读取最新版本。你的输入仍在编辑器中，请核对后再次保存。');
          }}
        >
          基于最新版本继续编辑
        </button>
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
