/** Per-instance admission; shares work only while it is running or queued, never caches results. */
export function createReadAdmission(options: { concurrency: number; maxPending: number; unavailable: () => Error }) {
  const inflight = new Map<string, Promise<unknown>>();
  const queue: Array<() => void> = [];
  let active = 0;
  function drain() {
    while (active < options.concurrency && queue.length) queue.shift()!();
  }
  return function read<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;
    if (active >= options.concurrency && queue.length >= options.maxPending) return Promise.reject(options.unavailable());
    const result = new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        void Promise.resolve().then(task).then(resolve, reject).finally(() => {
          inflight.delete(key);
          active--;
          drain();
        });
      });
    });
    inflight.set(key, result);
    drain();
    return result;
  };
}
