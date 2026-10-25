// Direct private links should open login while public discovery stays available.
export function requiresOwnerLogin(path: string): boolean {
  return /^\/dashboard\/(crossing|attention|settings|profile|messages|activity)(\/|$)/.test(
    path,
  );
}
