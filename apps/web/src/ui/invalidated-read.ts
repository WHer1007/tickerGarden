/** A read was cancelled because clear() invalidated its entire generation. */
export class InvalidatedReadClearedError extends Error {
  constructor() {
    super('Read cancelled because the invalidated-read state was cleared');
    this.name = 'InvalidatedReadClearedError';
  }
}

type Epoch = {
  cancelled: Promise<never>;
  cancel(error: Error): void;
};

type Flight<V> = {version: number; promise: Promise<V>};

/**
 * Coalesces same-key reads and makes callers that overlap an invalidation wait
 * for a load started in the newest generation. Results are not cached after a
 * load settles; callers should keep any resolved-value cache separately.
 *
 * clear() cancels every outstanding caller with InvalidatedReadClearedError.
 * The underlying loader cannot be aborted, but its eventual result is discarded
 * and cannot be reused by reads started after clear().
 */
export function createInvalidatedRead<K, V>() {
  let epoch = makeEpoch();
  let versions = new Map<K, number>();
  let flights = new Map<K, Flight<V>>();

  function makeEpoch(): Epoch {
    let cancel!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { cancel = reject; });
    // A clear may happen after the last read has finished. Keep the cancellation
    // promise handled even in that case.
    void cancelled.catch(() => {});
    return {cancelled, cancel};
  }

  function invalidate(key: K): void {
    versions.set(key, (versions.get(key) ?? 0) + 1);
  }

  function start(key: K, version: number, loader: () => Promise<V>): Flight<V> {
    const promise = Promise.resolve().then(loader);
    const flight = {version, promise};
    flights.set(key, flight);
    void promise.then(
      () => { if (flights.get(key) === flight) flights.delete(key); },
      () => { if (flights.get(key) === flight) flights.delete(key); },
    );
    return flight;
  }

  function read(key: K, loader: () => Promise<V>, options: {invalidate?: boolean} = {}): Promise<V> {
    if (options.invalidate) invalidate(key);
    // The first loader for a key/version owns that flight. Callers coalescing
    // into it intentionally share its result.
    const callEpoch = epoch;
    const run = async (): Promise<V> => {
      while (true) {
        if (epoch !== callEpoch) throw new InvalidatedReadClearedError();
        const version = versions.get(key) ?? 0;
        let flight = flights.get(key);
        if (flight && flight.version !== version) {
          // Let the older request finish before starting its one coalesced
          // follow-up. The result itself is discarded below.
          try {
            await Promise.race([flight.promise, callEpoch.cancelled]);
          } catch (error) {
            if (epoch !== callEpoch) throw new InvalidatedReadClearedError();
            if ((versions.get(key) ?? 0) === flight.version) throw error;
          }
          continue;
        }
        if (!flight) {
          flight = start(key, version, loader);
        }
        try {
          const value = await Promise.race([flight.promise, callEpoch.cancelled]);
          if (epoch !== callEpoch) throw new InvalidatedReadClearedError();
          if ((versions.get(key) ?? 0) !== flight.version) continue;
          return value;
        } catch (error) {
          if (epoch !== callEpoch) throw new InvalidatedReadClearedError();
          // An invalidation that arrived during a failed load still requires a
          // fresh attempt. A failure in the current generation reaches callers.
          if ((versions.get(key) ?? 0) !== flight.version) continue;
          throw error;
        }
      }
    };
    return run();
  }

  function clear(): void {
    const previous = epoch;
    epoch = makeEpoch();
    versions = new Map<K, number>();
    flights = new Map<K, Flight<V>>();
    previous.cancel(new InvalidatedReadClearedError());
  }

  return {read, invalidate, clear};
}
