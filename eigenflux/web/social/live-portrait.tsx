import { feedbackMessage } from '../feedback-message';
import { ContentState } from '../recovery';
import { useEffect, useRef, useState } from 'react';
import { api, refreshData } from '../api';
import type { CompanionSettings, CompanionResponse } from '../companion';
import { PortraitEditor } from './portrait';
import {
  loadPortrait,
  writePortrait,
  type SavedPortrait,
} from './portrait-api';
import type { Portrait } from './portrait-data';
export function LivePortrait({
  onPublicHome,
  focusMemory = false,
  onSaved,
}: {
  onPublicHome: () => void;
  focusMemory?: boolean;
  onSaved?: (p: SavedPortrait) => void;
}) {
  const [companion, setCompanion] = useState<CompanionSettings>();
  const [profile, setProfile] = useState<SavedPortrait>();
  const current = useRef<SavedPortrait | undefined>(undefined);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([
      loadPortrait(),
      api<CompanionResponse>('console/companion'),
    ])
      .then(([p, settings]) => {
        if (active) {
          setCompanion(settings.settings);
          current.current = p;
          setProfile({
            ...p,
            fields: {
              ...p.fields,
              connections:
                p.fields.connections || settings.settings.connection_goal,
            },
          });
          setError('');
        }
      })
      .catch((e: unknown) => {
        if (active) setError(feedbackMessage(e, '资料读取失败'));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  async function save(next: Portrait) {
    if (!current.current) throw new Error('资料尚未载入');
    if (!companion) throw new Error('助手资料尚未载入');
    const settings = await api<CompanionSettings>(
      'console/companion',
      {
        ...companion,
        connection_goal: (next.fields.connections || '').trim(),
      },
      'PUT',
    );
    setCompanion(settings);
    refreshData();
    const p = await writePortrait(current.current, next);
    current.current = p;
    setProfile(p);
    onSaved?.(p);
  }
  return (
    <>
      {error && !profile && <ContentState title="资料暂时没有加载出来" action={() => retry((n) => n + 1)} />}
      {profile ? (
        <PortraitEditor
          profile={profile}
          companion={companion}
          onCompanionChange={setCompanion}
          onSave={save}
          onPublicHome={onPublicHome}
          focusMemory={focusMemory}
        />
      ) : (
        !error && <ContentState title="正在打开资料" loading />
      )}
    </>
  );
}
