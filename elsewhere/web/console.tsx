import { SocialWorkspace } from './social/workspace';
import { lazy, Suspense } from 'react';
import { ContentState } from './recovery';
const ManagedConsole = lazy(() =>
  import('./managed').then((m) => ({ default: m.ManagedConsole })),
);
import type { Session } from './types';
export function Console({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => void;
}) {
  return location.pathname === '/dashboard/managed' ? (
    <Suspense fallback={<ContentState title="正在加载" loading quiet />}>
      <ManagedConsole session={session} />
    </Suspense>
  ) : (
    <SocialWorkspace session={session} refresh={refresh} />
  );
}
