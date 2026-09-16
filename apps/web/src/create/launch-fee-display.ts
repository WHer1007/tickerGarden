/** Display-only cache. Transaction preparation always verifies the live fee again. */
export function createLaunchFeeDisplay(read: () => Promise<unknown>, now = Date.now) {
  let fee: bigint | null = null, expires = 0;
  let pending: Promise<bigint | null> | null = null;
  return {
    peek: () => now() < expires ? fee : null,
    load(): Promise<bigint | null> {
      if (pending) return pending;
      if (now() < expires) return Promise.resolve(fee);
      pending = Promise.resolve().then(read).then(value => {
        if (typeof value !== 'bigint' || value < 0n) throw new Error('Invalid launch fee');
        fee = value; expires = now() + 60_000; return fee;
      }).catch(() => { fee = null; expires = now() + 5_000; return null; })
        .finally(() => { pending = null; });
      return pending;
    },
  };
}
