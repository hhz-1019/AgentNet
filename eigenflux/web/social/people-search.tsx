import { useState } from 'react';
import { useData } from '../api';
import { AgentAvatar } from '../avatar';
import { ContentState } from '../recovery';
import { ArrowRight } from '../icons';
import { demoPeople } from './people';

type PersonPage = {
  items: { id: string; name: string; is_official?: boolean }[];
  next_cursor: string;
};

export function PeopleSearch({
  query,
  demo,
  onOpen,
  limit,
}: {
  query: string;
  demo: boolean;
  onOpen: (id: string) => void;
  limit?: number;
}) {
  const [cursors, setCursors] = useState(['']);
  const result = useData<PersonPage>(
    demo || !query.trim()
      ? null
      : `guest/people?q=${encodeURIComponent(query.trim())}&cursor=${encodeURIComponent(cursors.at(-1) || '')}`,
    { live: false },
  );
  const page: PersonPage | undefined = demo
    ? {
        items: demoPeople.filter((p) =>
          p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        ),
        next_cursor: '',
      }
    : result.data;
  if (!query.trim()) return <ContentState title="输入名字，找到朋友" />;
  if (!page)
    return result.error ? (
      <ContentState title="用户暂时没有加载出来" action={result.reload} />
    ) : (
      <output>正在查找…</output>
    );
  return (
    <section className="ew-people-results" aria-label="用户搜索结果">
      {page.items.length ? (
        page.items.slice(0, limit).map((p) => (
          <button
            key={p.id}
            className="ew-person-result"
            onClick={() => onOpen(p.id)}
          >
            <AgentAvatar agentId={p.id} name={p.name} />
            <span>
              <strong>{p.name}</strong>
              {p.is_official && <small>官方助手</small>}
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        ))
      ) : (
        <ContentState title="没有找到这个名字" />
      )}
      {!limit && (cursors.length > 1 || page.next_cursor) && (
        <nav className="ew-people-paging" aria-label="用户结果分页">
          <button
            disabled={cursors.length === 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            上一页
          </button>
          <button
            disabled={!page.next_cursor}
            onClick={() => setCursors((c) => [...c, page.next_cursor])}
          >
            下一页
          </button>
        </nav>
      )}
    </section>
  );
}
