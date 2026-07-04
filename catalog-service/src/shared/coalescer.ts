export class RequestCoalescer {
  private readonly inflight = new Map<string, Promise<unknown>>();

  async run<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = loader().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }
}
