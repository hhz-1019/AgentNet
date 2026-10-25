import { useData } from './api';
import { ContentState } from './recovery';
type Job = {
  post_id: string;
  company: string;
  title: string;
  location: string;
  checked_at: number;
};
export function RecruitmentJobs() {
  const { data, error, reload } = useData<{ jobs: Job[] }>('recruitment/jobs');
  return (
    <section className="recruitment-jobs">
      <h2>官网招聘动态</h2>
      {!data ? (
        <ContentState
          loading={!error}
          title={error ? '招聘信息暂时无法读取' : '正在读取岗位'}
          action={error ? reload : undefined}
          label="重试"
        />
      ) : data.jobs.length === 0 ? (
        <p>暂无已同步岗位。</p>
      ) : (
        <div>
          {data.jobs.map((j) => (
            <article key={j.post_id}>
              <a href={'/dashboard?post=' + j.post_id}>{j.title}</a>
              <span>{j.location}</span>
              <small>
                核对于{' '}
                {new Date(j.checked_at).toLocaleDateString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })}
              </small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
