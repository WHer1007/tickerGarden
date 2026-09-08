// Test-only pure settlement planner; no transport or submission code.
import { createHash } from "node:crypto";

export type ConversionItem = Readonly<{ user: string; creatorEpoch: number; maximumMeme: bigint }>;
export type PendingRewardParticipant = Readonly<ConversionItem>;
export type RewardSettlementQuote = Readonly<{
  expectedOutput: bigint; quotedAt: number; requestDigest: string; referenceId: string; marketId: string; chainId: number;
}>;
export type RewardSettlementPlanInput = Readonly<{
  chainId: number; marketId: string; now: number; pendingParticipants: readonly PendingRewardParticipant[];
  rawExitAt: ReadonlyMap<string, bigint> | Readonly<Record<string, bigint>>; perBatchCap: bigint; totalMeme: bigint;
  max32?: number; deadline: number; quote?: RewardSettlementQuote; slippageBps: number;
}>;
export type RewardSettlementBatch = Readonly<{
  marketId: string; items: readonly ConversionItem[]; minimumQuote: bigint; deadline: number;
  requestDigest: string; quoteReferenceId: string;
}>;
export type RewardSettlementPlan = Readonly<{
  marketId: string; chainId: number; items: readonly ConversionItem[]; batches: readonly RewardSettlementBatch[];
  requestDigest: string; minimumQuote: bigint; deadline: number; quoteReferenceId: string;
}>;

const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const UINT32_MAX = 0xffffffff;

function asBigInt(value: bigint | number | string, label: string): bigint {
  try { const result = typeof value === "bigint" ? value : BigInt(value); if (result < 0n) throw new Error(); return result; }
  catch { throw new TypeError(`${label} must be a non-negative integer`); }
}
function canonicalHash(value: string, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new TypeError(`${label} must be a lowercase canonical bytes32`);
  return value;
}
function canonicalAddress(value: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new TypeError("user must be a lowercase canonical address");
  return value;
}
function rawExit(source: RewardSettlementPlanInput["rawExitAt"], user: string): bigint {
  const value = source instanceof Map ? source.get(user) : (source as Readonly<Record<string, bigint>>)[user];
  return value === undefined ? 0n : asBigInt(value, "rawExitAt");
}

/** Binds the exact chain, market, item order, roles, users, and amounts. */
export function rewardSettlementRequestDigest(chainId: number, marketId: string, items: readonly ConversionItem[]): string {
  canonicalHash(marketId, "marketId");
  const body = JSON.stringify({ chainId, marketId, items: items.map((item) => ({
    user: item.user, creatorEpoch: item.creatorEpoch, maximumMeme: item.maximumMeme.toString(),
  })) });
  return `0x${createHash("sha256").update(body, "utf8").digest("hex")}`;
}
export const requestDigest = rewardSettlementRequestDigest;

export function planRewardSettlement(input: RewardSettlementPlanInput): RewardSettlementPlan {
  canonicalHash(input.marketId, "marketId");
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) throw new RangeError("chainId must be a positive integer");
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new RangeError("now must be a non-negative timestamp");
  if (!Number.isSafeInteger(input.deadline) || input.deadline < input.now || input.deadline > input.now + 300) throw new RangeError("deadline must be no more than 300 seconds from now");
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 100) throw new RangeError("slippageBps must be between 0 and 100");
  const batchCap = asBigInt(input.perBatchCap, "perBatchCap");
  const totalCap = asBigInt(input.totalMeme, "totalMeme");
  const maxItems = input.max32 ?? 32;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 32) throw new RangeError("max32 must be an integer from 1 to 32");
  const seen = new Set<string>(); const items: ConversionItem[] = [];
  for (const participant of input.pendingParticipants) {
    const user = canonicalAddress(participant.user); const epoch = Number(participant.creatorEpoch);
    if (!Number.isInteger(epoch) || epoch < 0 || epoch > UINT32_MAX) throw new RangeError("creatorEpoch must be uint32");
    const duplicateKey = `${user}:${epoch}`;
    if (seen.has(duplicateKey)) throw new Error(`duplicate participant ${duplicateKey}`);
    seen.add(duplicateKey);
    const amount = asBigInt(participant.maximumMeme, "maximumMeme"); const exitAt = rawExit(input.rawExitAt, user);
    if (amount === 0n || (exitAt !== 0n && exitAt <= BigInt(input.now))) continue;
    items.push(Object.freeze({ user, creatorEpoch: epoch, maximumMeme: amount }));
  }
  const digest = rewardSettlementRequestDigest(input.chainId, input.marketId, items);
  if (items.length === 0) return Object.freeze({ marketId: input.marketId, chainId: input.chainId, items: Object.freeze([]), batches: Object.freeze([]), requestDigest: digest, minimumQuote: 0n, deadline: input.deadline, quoteReferenceId: "" });
  const sum = items.reduce((total, item) => total + item.maximumMeme, 0n);
  if (items.length > maxItems) throw new RangeError("settlement exceeds max32 item bound");
  if (sum > batchCap) throw new RangeError("settlement exceeds perBatchCap");
  if (sum > totalCap) throw new RangeError("settlement exceeds totalMeme cap");
  if (!input.quote) throw new Error("a non-empty settlement requires a quote");
  if (!Number.isSafeInteger(input.quote.quotedAt) || input.quote.quotedAt > input.now || input.now - input.quote.quotedAt > 30) throw new Error("quote is stale or from the future");
  if (input.quote.chainId !== input.chainId || input.quote.marketId !== input.marketId) throw new Error("quote market or chain mismatch");
  if (input.quote.referenceId.length === 0) throw new Error("quote referenceId is required");
  if (input.quote.requestDigest !== digest) throw new Error("quote request digest mismatch");
  const expected = asBigInt(input.quote.expectedOutput, "quote expectedOutput"); if (expected <= 0n) throw new Error("quote expectedOutput must be positive");
  const minimumQuote = expected * BigInt(10000 - input.slippageBps) / 10000n;
  if (minimumQuote <= 0n) throw new Error("minimumQuote must be positive");
  const batch = Object.freeze({ marketId: input.marketId, items: Object.freeze(items), minimumQuote, deadline: input.deadline, requestDigest: digest, quoteReferenceId: input.quote.referenceId });
  return Object.freeze({ marketId: input.marketId, chainId: input.chainId, items: Object.freeze(items), batches: Object.freeze([batch]), requestDigest: digest, minimumQuote, deadline: input.deadline, quoteReferenceId: input.quote.referenceId });
}

