/**
 * Conservative CU budget for read-only RPC calls.
 *
 * The limiter charges an attempt when acquire() is admitted. Callers must call
 * acquire() for every retry; the limiter deliberately has no refund operation.
 */

export const RPC_METHOD_CU = Object.freeze({
  eth_chainId: 500,
  eth_blockNumber: 500,
  eth_estimateGas: 500,
  eth_getTransactionByHash: 500,
  eth_sendRawTransaction: 500,
  eth_getStorageAt: 500,
  eth_getTransactionCount: 500,
  eth_gasPrice: 500,
  eth_maxPriorityFeePerGas: 500,
  eth_getBlockByNumber: 500,
  eth_getBlockByHash: 500,
  eth_getBlockReceipts: 500,
  eth_getLogs: 500,
  eth_getTransactionReceipt: 500,
  eth_getCode: 500,
  eth_call: 500,
  eth_getBalance: 500,
});

export function rpcMethodCost(method) {
  return RPC_METHOD_CU[method];
}

export class RollingCuLimiter {
  #maxCu;
  #windowMs;
  #now;
  #sleep;
  #queue = Promise.resolve();
  #charges = [];

  constructor({ maxCu = 10_000, windowMs = 1_000, now = () => performance.now(), sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (!Number.isInteger(maxCu) || maxCu <= 0 || maxCu > 10_000) throw new RangeError('maxCu must be in (0, 10000]');
    if (!Number.isInteger(windowMs) || windowMs < 1_000) throw new RangeError('windowMs must be at least 1000');
    if (typeof now !== 'function' || typeof sleep !== 'function') throw new TypeError('now and sleep must be functions');
    this.#maxCu = maxCu;
    this.#windowMs = windowMs;
    this.#now = now;
    this.#sleep = sleep;
  }

  acquire(cost) {
    if (!Number.isFinite(cost) || cost <= 0 || !Number.isInteger(cost) || cost > this.#maxCu) {
      return Promise.reject(new RangeError('cost must be a positive integer no greater than the budget'));
    }
    const run = this.#queue.then(() => this.#admit(cost));
    this.#queue = run.catch(() => {});
    return run;
  }

  async #admit(cost) {
    for (;;) {
      const now = this.#now();
      while (this.#charges.length && this.#charges[0].at + this.#windowMs <= now) this.#charges.shift();
      const used = this.#charges.reduce((sum, charge) => sum + charge.cost, 0);
      if (used + cost <= this.#maxCu) {
        this.#charges.push({ at: now, cost });
        return;
      }
      const waitMs = Math.max(0, this.#charges[0].at + this.#windowMs - now);
      await this.#sleep(waitMs);
    }
  }
}
