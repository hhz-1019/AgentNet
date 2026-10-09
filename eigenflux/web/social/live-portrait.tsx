import { useEffect, useRef, useState } from 'react';
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
  const [profile, setProfile] = useState<SavedPortrait>();
  const current = useRef<SavedPortrait | undefined>(undefined);
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    void loadPortrait()
      .then((p) => {
        if (active) {
          current.current = p;
          setProfile(p);
          setError('');
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : '资料读取失败');
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  async function save(next: Portrait) {
    if (!current.current) throw new Error('资料尚未载入');
    const p = await writePortrait(current.current, next);
    current.current = p;
    setProfile(p);
    onSaved?.(p);
  }
  return (
    <>
      {error && (
        <p role="alert">
          {error} <button onClick={() => retry((n) => n + 1)}>重新载入</button>
        </p>
      )}
      {profile ? (
        <PortraitEditor
          profile={profile}
          onSave={save}
          onPublicHome={onPublicHome}
          focusMemory={focusMemory}
        />
      ) : (
        !error && <p>正在读取资料…</p>
      )}
    </>
  );
}
