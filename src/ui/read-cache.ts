type Entry<T> = { value: T; expires: number };
type Pending<T> = { controller: AbortController; promise: Promise<T> };

export class ReadCache<T> {
  private entries = new Map<string, Entry<T>>();
  private pending = new Map<string, Pending<T>>();
  private ttl: number;
  private limit: number;
  private clock: () => number;
  constructor(ttl = 60000, limit = 100, clock = Date.now) {
    this.ttl = ttl;
    this.limit = limit;
    this.clock = clock;
  }

  peek(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  read(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const cached = this.peek(key);
    if (cached !== undefined) return Promise.resolve(cached);
    let request = this.pending.get(key);
    if (!request) {
      const controller = new AbortController();
      const current: Pending<T> = {
        controller,
        promise: Promise.resolve(undefined as T),
      };
      current.promise = Promise.resolve()
        .then(() => load(controller.signal))
        .then((value) => {
          // An invalidated request cannot repopulate the cache after a mutation.
          if (this.pending.get(key) !== current || controller.signal.aborted) {
            throw new DOMException("Read invalidated", "AbortError");
          }
          this.entries.set(key, { value, expires: this.clock() + this.ttl });
          while (this.entries.size > this.limit)
            this.entries.delete(this.entries.keys().next().value!);
          return value;
        })
        .finally(() => {
          if (this.pending.get(key) === current) this.pending.delete(key);
        });
      this.pending.set(key, current);
      request = current;
    }
    // Leaving one view does not cancel another reader or a useful cache fill.
    if (!signal) return request.promise;
    const promise = request.promise;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      promise
        .then((value) => {
          if (!signal.aborted) resolve(value);
        }, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }

  invalidate(prefix = "") {
    for (const key of this.entries.keys())
      if (key.startsWith(prefix)) this.entries.delete(key);
    for (const [key, request] of this.pending) {
      if (!key.startsWith(prefix)) continue;
      this.pending.delete(key);
      request.controller.abort();
    }
  }
}
