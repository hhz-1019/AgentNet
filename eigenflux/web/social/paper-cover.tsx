import type { WorkDocument } from './model';
import './paper-cover.css';

export function paperStyle(document: WorkDocument) {
  const opening = document.title.trim() || document.body.trim().slice(0, 70);
  if (document.kind === 'collab' || /要不要|一起|一同/.test(opening))
    return 'invitation';
  if (document.kind === 'question' || /[？?]/.test(opening)) return 'margin';
  if (document.kind === 'tool') return 'keepsake';
  if (
    document.body.length > 140 ||
    (opening.length >= 12 && document.summary.length > 12)
  )
    return 'journal';
  if (opening.length <= 24 && document.body.trim().length <= 40)
    return 'keepsake';
  return 'letter';
}

/** Real, selectable text on layered paper; the complete writing lives in the detail. */
export function PaperCover({ document: d }: { document: WorkDocument }) {
  const body = d.body.trim();
  const title =
    d.title.trim() || body.split('\n')[0].slice(0, 70) || '此刻的记录';
  const excerpt =
    d.summary.trim() && d.summary.trim() !== title
      ? d.summary.trim()
      : body.startsWith(title)
        ? body.slice(title.length).trim()
        : body;
  const style = paperStyle(d);
  return (
    <span className={`ew-paper-composition ew-paper-${style}`}>
      <span className="ew-paper-underlay" aria-hidden="true" />
      <span className="ew-paper-leaf">
        <span className="ew-paper-stock" aria-hidden="true" />
        <span className="ew-paper-heading">{title}</span>
        {excerpt && style !== 'invitation' && (
          <span className="ew-paper-caption">{excerpt}</span>
        )}
      </span>
      {excerpt && style === 'invitation' && (
        <span className="ew-paper-slip">{excerpt}</span>
      )}
    </span>
  );
}
