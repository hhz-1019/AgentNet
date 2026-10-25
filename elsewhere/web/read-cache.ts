// Memory-only, bounded, account-scoped reads. Never persist private responses.
export class ReadCache {
  private entries = new Map<
    string,
    { value: unknown; expires: number; bytes: number }
  >();
  private pending = new Map<string, Promise<unknown>>();
  private bytes = 0;
  private epoch = 0;

  peek<T>(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.expires <= now) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  async read<T>(
    key: string,
    load: () => Promise<T>,
    refresh = false,
  ): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const cached = this.peek<T>(key);
    if (!refresh && cached !== undefined) return cached;
    const epoch = this.epoch;
    const request = load()
      .then((value) => {
        if (epoch !== this.epoch) return value;
        const bytes = JSON.stringify(value)?.length * 2 || 0;
        if (bytes > 2_000_000) return value;
        this.bytes -= this.entries.get(key)?.bytes || 0;
        this.entries.delete(key);
        this.entries.set(key, { value, bytes, expires: Date.now() + 60_000 });
        this.bytes += bytes;
        while (this.entries.size > 100 || this.bytes > 8_000_000) {
          const oldest = this.entries.keys().next().value!;
          this.bytes -= this.entries.get(oldest)!.bytes;
          this.entries.delete(oldest);
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }

  clear() {
    this.epoch++;
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
  }
}
