import { createContext, useContext, useLayoutEffect, useRef } from 'react';

export interface EntryTask {
  pending: boolean;
  failed: boolean;
}
export const EntryPreparationContext = createContext<
  ((id: symbol, task: EntryTask | null) => void) | null
>(null);

// Report preparation; never defer mounting or network requests until the
// curtain has gone. Unmounted destinations cannot leave a stuck task behind.
export function useEntryPreparation(pending: boolean, failed = false) {
  const report = useContext(EntryPreparationContext);
  const id = useRef(Symbol('entry preparation'));
  useLayoutEffect(() => {
    const key = id.current;
    report?.(key, pending || failed ? { pending, failed } : null);
    return () => report?.(key, null);
  }, [report, pending, failed]);
}

export function entryContentState(ready: boolean, tasks: Iterable<EntryTask>) {
  let pending = false;
  let failed = false;
  for (const task of tasks) {
    pending ||= task.pending;
    failed ||= task.failed;
  }
  return { ready: ready && !pending, failed };
}
