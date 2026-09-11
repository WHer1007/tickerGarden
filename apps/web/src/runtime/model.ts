import { ROBINHOOD_CHAIN_ID } from "../v1/chain.ts";
import { concatHex, formatUnits, keccak256, parseUnits, type Address, type Hex } from "viem";
import type {
  ConfigReadModel,
  MarketReadModel,
  SyncStatus,
  UserPositionReadModel,
} from "../v1/readApi.ts";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;
export const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
export const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
export const MAX_UINT256 = (1n << 256n) - 1n;

export const PHASE_LABELS = ["Growing", "Bloomed"] as const;

export function phaseLabel(phase: number): string {
  return PHASE_LABELS[phase] ?? `Phase ${phase}`;
}

export function shortHex(value: string | null | undefined, left = 6, right = 4): string {
  if (!value) return "-";
  if (value.length <= left + right + 2) return value;
  return `${value.slice(0, left + 2)}…${value.slice(-right)}`;
}

export function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "The operation could not be completed.";
}

export function canonicalAddress(value: string, label: string, allowZero = false): Address {
  const normalized = value.toLowerCase();
  if (!ADDRESS_PATTERN.test(normalized) || (!allowZero && normalized === ZERO_ADDRESS)) {
    throw new TypeError(`${label} must be a lowercase ${allowZero ? "" : "non-zero "}address`);
  }
  return normalized as Address;
}

export function canonicalBytes32(value: string, label: string, allowZero = false): Hex {
  const normalized = value.toLowerCase();
  if (!BYTES32_PATTERN.test(normalized) || (!allowZero && normalized === ZERO_BYTES32)) {
    throw new TypeError(`${label} must be a lowercase ${allowZero ? "" : "non-zero "}bytes32`);
  }
  return normalized as Hex;
}

export function configString(config: ConfigReadModel, key: string): string {
  const value = config.values[key];
  if (typeof value !== "string") throw new Error(`${config.kind}.${key} is missing from the reconciled API response`);
  return value;
}

export function configNumber(config: ConfigReadModel, key: string): number {
  const value = config.values[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${config.kind}.${key} is invalid`);
  return value;
}

export function configBigInt(config: ConfigReadModel, key: string): bigint {
  const value = config.values[key];
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${config.kind}.${key} is not an unsigned integer string`);
  }
  return BigInt(value);
}

export function assertFinalizedSync(sync: SyncStatus, expectedRevision?: string, label = "snapshot"): void {
  if (
    sync.chainId !== ROBINHOOD_CHAIN_ID
    || sync.status !== "synced"
    || sync.finality !== "finalized"
    || typeof sync.blockNumber !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(sync.blockNumber)
    || typeof sync.blockHash !== "string"
    || !BYTES32_PATTERN.test(sync.blockHash)
    || sync.revision !== `${sync.blockNumber}:${sync.blockHash}`
    || (expectedRevision !== undefined && sync.revision !== expectedRevision)
  ) throw new Error(`${label} is not the expected finalized Robinhood Chain snapshot`);
}

export function parseTokenAmount(value: string, decimals: number, label: string): bigint {
  const normalized = value.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new RangeError(`${label} decimals are invalid`);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(normalized)) throw new TypeError(`${label} must be a plain positive decimal amount`);
  const fraction = normalized.split(".")[1] ?? "";
  if (fraction.length > decimals) throw new RangeError(`${label} has more than ${decimals} decimal places`);
  const result = parseUnits(normalized, decimals);
  if (result <= 0n || result > MAX_UINT256) throw new RangeError(`${label} must fit a positive uint256`);
  return result;
}

export function parseUint32(value: string, label: string): number {
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) throw new TypeError(`${label} must be a positive integer`);
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result > 0xffff_ffff) throw new RangeError(`${label} exceeds uint32`);
  return result;
}

export function parseSlippageBps(value: string): number {
  const normalized = value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) throw new TypeError("Slippage must be an integer number of basis points");
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result < 0 || result > 5_000) {
    throw new RangeError("Slippage must be between 0 and 5000 basis points");
  }
  return result;
}

export function minimumAfterSlippage(amount: bigint, bps: number): bigint {
  if (amount <= 0n) throw new RangeError("Quoted output must be positive");
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 5_000) throw new RangeError("Invalid slippage basis points");
  const minimum = amount * BigInt(10_000 - bps) / 10_000n;
  return minimum > 0n ? minimum : 1n;
}

/** Reconstruct an OpenZeppelin-compatible commutative Merkle proof root. */
export function foldSortedMerkleProof(leaf: Hex, proof: readonly Hex[]): Hex {
  const initial = canonicalBytes32(leaf, "Merkle leaf", true);
  return proof.reduce((computed, rawItem) => {
    const item = canonicalBytes32(rawItem, "Merkle proof item", true);
    const [left, right] = computed <= item ? [computed, item] : [item, computed];
    return keccak256(concatHex([left, right]));
  }, initial);
}

export function formatTokenAmount(value: bigint | string, decimals: number, precision = 6): string {
  try {
    const formatted = formatUnits(typeof value === "bigint" ? value : BigInt(value), decimals);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmed = fraction.slice(0, precision).replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole ?? "0";
  } catch {
    return "-";
  }
}

export function tupleField(value: unknown, name: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  if (value !== null && typeof value === "object" && name in value) {
    return (value as Record<string, unknown>)[name];
  }
  throw new Error(`Onchain tuple field ${name} is missing`);
}

export function tupleBigInt(value: unknown, name: string, index: number): bigint {
  const item = tupleField(value, name, index);
  if (typeof item !== "bigint") throw new Error(`Onchain tuple field ${name} is not an integer`);
  return item;
}

export function tupleNumber(value: unknown, name: string, index: number): number {
  const item = tupleField(value, name, index);
  const result = typeof item === "bigint" ? Number(item) : item;
  if (typeof result !== "number" || !Number.isSafeInteger(result)) throw new Error(`Onchain tuple field ${name} is invalid`);
  return result;
}

export function tupleString(value: unknown, name: string, index: number): string {
  const item = tupleField(value, name, index);
  if (typeof item !== "string") throw new Error(`Onchain tuple field ${name} is not a string`);
  return item;
}

export interface MarketMetadata {
  readonly metadataURI?: string;
  readonly deployedAt?: string;
  readonly name: string;
  readonly symbol: string;
  readonly quoteSymbol: string;
  readonly quoteDecimals: number;
}

export interface PositionBundle {
  readonly position: UserPositionReadModel;
  readonly market: MarketReadModel;
  readonly asset: ConfigReadModel;
}

export function positionKey(position: UserPositionReadModel): string {
  return `${position.assetUid}:${position.marketId}`;
}
