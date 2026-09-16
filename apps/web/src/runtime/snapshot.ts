import type { Hash } from "viem";
import type { SyncStatus } from "../v1/readApi.ts";
import { assertFinalizedSync, BYTES32_PATTERN } from "./model.ts";

/** Accept finalized progress only if the original snapshot still belongs to the canonical chain. */
export async function assertCanonicalSnapshotContinuation(
  current: SyncStatus,
  expectedRevision: string,
  blockHash: (number: bigint) => Promise<Hash | null>,
): Promise<void> {
  assertFinalizedSync(current);
  if (current.blockNumber === null) throw new Error("Missing finalized height");
  const [number, hash, extra] = expectedRevision.split(":");
  if (!number || !hash || extra !== undefined || !/^(0|[1-9][0-9]*)$/.test(number) || !BYTES32_PATTERN.test(hash)) {
    throw new Error("Invalid original snapshot revision");
  }
  if (BigInt(current.blockNumber) < BigInt(number)) throw new Error("The finalized snapshot regressed");
  if (current.revision === expectedRevision) return;
  if (BigInt(current.blockNumber) === BigInt(number) || (await blockHash(BigInt(number)))?.toLowerCase() !== hash) {
    throw new Error("The quote snapshot is no longer canonical");
  }
}

export async function mapConcurrent<T, R>(items: readonly T[], action: (item: T) => Promise<R>, concurrency = 6): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency");
  const result: R[] = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) { const next = index++; result[next] = await action(items[next]!); }
  }));
  return result;
}
