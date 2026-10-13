import { type ReactNode } from 'react';
import './auth-journal.css';

export function AuthScene({ children }: { children: ReactNode }) {
  return (
    <div className="auth-scene">
      <div className="auth-scene-content">{children}</div>
    </div>
  );
}
