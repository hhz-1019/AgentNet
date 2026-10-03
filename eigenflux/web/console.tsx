import { SocialWorkspace } from './social/workspace';
import type { Session } from './types';
export function Console({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => void;
}) {
  return <SocialWorkspace session={session} refresh={refresh} />;
}
