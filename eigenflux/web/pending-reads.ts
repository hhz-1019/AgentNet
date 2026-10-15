// Share only overlapping reads. Completed values are never cached, and an
// explicit refresh or write separates subsequent reads from the old request.
export class PendingReads {
  private pending = new Map<string, Promise<unknown>>();

  clear() {
    this.pending.clear();
  }

  read<T>(key: string, request: () => Promise<T>): Promise<T> {
    let pending = this.pending.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = request();
      this.pending.set(key, pending);
      const current = pending;
      const remove = () => {
        if (this.pending.get(key) === current) this.pending.delete(key);
      };
      void pending.then(remove, remove);
    }
    // Consumers such as portrait pagination append to their own result.
    return pending.then((value) => structuredClone(value));
  }
}
