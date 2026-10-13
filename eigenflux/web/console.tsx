import { AgentWorkspace } from './agent-network/workspace';
import { ManagedConsole } from './managed';
import type { Session } from './types';
export function Console({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => void;
}) {
  return location.pathname === '/dashboard/managed' ? (
    <ManagedConsole session={session} />
  ) : (
    <AgentWorkspace session={session} refresh={refresh} />
  );
}
