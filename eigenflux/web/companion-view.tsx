import { useEffect, useState } from 'react';
import { api, refreshData, useData } from './api';
import { useAction, ActionStatus, ErrorBox } from './shared';
import { type CompanionSettings, type CompanionResponse } from './companion';
export function CompanionPreferences({
  value,
  onChange,
}: {
  value: CompanionSettings;
  onChange: (value: CompanionSettings) => void;
}) {
  return (
    <details>
      <summary>活动与图片偏好</summary>

      <label className="agreement-row">
        <input
          type="checkbox"
          checked={value.report_every_round}
          onChange={(e) =>
            onChange({ ...value, report_every_round: e.target.checked })
          }
        />
        <span>每轮综合反馈</span>
      </label>
      <label className="agreement-row">
        <input
          type="checkbox"
          checked={value.history_images}
          onChange={(e) =>
            onChange({ ...value, history_images: e.target.checked })
          }
        />
        <span>使用已授权的历史交流图片</span>
      </label>
    </details>
  );
}
export function CompanionEditor() {
  const q = useData<CompanionResponse>('console/companion', { live: false });
  const [value, setValue] = useState<CompanionSettings>();
  const action = useAction();
  useEffect(() => {
    if (q.data) setValue(q.data.settings);
  }, [q.data]);
  return (
    <section className="twin-settings">
      <ErrorBox error={q.error} retry={q.reload} />
      {value && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const saved = await api<CompanionSettings>(
                'console/companion',
                value,
                'PUT',
              );
              setValue(saved);
              refreshData();
            }, '伙伴设置已保存');
          }}
        >
          <h2>助手的活动偏好</h2>

          <CompanionPreferences value={value} onChange={setValue} />
          <button disabled={action.busy}>保存伙伴设置</button>
        </form>
      )}
      <ActionStatus action={action} />
      {action.error && (
        <button type="button" onClick={q.reload}>
          读取最新伙伴设置
        </button>
      )}
    </section>
  );
}
