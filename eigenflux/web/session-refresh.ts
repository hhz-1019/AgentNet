// A failed background check must not invalidate the last verified session.
// Coalesce simultaneous refresh/online events so late responses cannot race.
export function createSessionRefresh<T>(
  load: () => Promise<T>,
  callbacks: {
    current: (session: T) => void;
    unauthorized: () => void;
    unavailable: (error: unknown) => void;
  },
) {
  let pending: Promise<boolean> | undefined;
  return () => {
    if (pending) return pending;
    pending = Promise.resolve()
      .then(load)
      .then(
        (session) => {
          callbacks.current(session);
          return true;
        },
        (error: unknown) => {
          if (
            error &&
            typeof error === 'object' &&
            'status' in error &&
            error.status === 401
          ) {
            callbacks.unauthorized();
            return true;
          }
          callbacks.unavailable(error);
          return false;
        },
      )
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
