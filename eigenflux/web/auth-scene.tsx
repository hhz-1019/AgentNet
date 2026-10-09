import { useRef, type ReactNode } from 'react';
import {
  AtmosphereToggle,
  JournalAtmosphere,
  useJournalAtmosphere,
} from './social/journal-atmosphere';
import './social/journal-atmosphere.css';
import './auth-journal.css';

/** Authentication shares the journal's light; fields and paper stay still. */
export function AuthScene({ children }: { children: ReactNode }) {
  const scene = useRef<HTMLDivElement>(null);
  const atmosphere = useJournalAtmosphere(scene, 'auth', false);
  return (
    <div className="auth-scene" ref={scene}>
      <JournalAtmosphere background={atmosphere.background} />
      <div className="auth-scene-content">{children}</div>
      <footer className="auth-scene-footer">
        <AtmosphereToggle {...atmosphere} />
      </footer>
    </div>
  );
}
