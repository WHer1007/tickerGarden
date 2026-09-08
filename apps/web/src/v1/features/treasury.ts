import { ROBINHOOD_CHAIN_ID } from "../chain.ts";
import type { Address, Hex } from "viem";
import { v1Abis } from "../generated/abis.ts";
import { createContractWriteRequest, type ContractWriteRequest } from "../transaction.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface TreasuryClaimProof {
  readonly schema: "TICKERGARDEN_V1_TREASURY_CLAIM_PROOF_V1";
  readonly executionSpecId: "V1-TREASURY-EXEC-1";
  readonly chainId: 4663 | 46630 | 421614;
  readonly distributor: Address;
  readonly marketId: Hex;
  readonly epochId: number;
  readonly leafIndex: bigint;
  readonly account: Address;
  readonly twab: bigint;
  readonly amount: bigint;
  readonly merkleRoot: Hex;
  readonly datasetHash: Hex;
  readonly proof: readonly Hex[];
}

function address(value: string, label: string, allowZero = false): Address {
  const normalized = value.toLowerCase();
  if (!ADDRESS.test(normalized) || (!allowZero && normalized === ZERO_ADDRESS)) {
    throw new TypeError(`${label} must be a canonical ${allowZero ? "" : "non-zero "}address`);
  }
  return normalized as Address;
}

function bytes32(value: string, label: string, allowZero = false): Hex {
  const normalized = value.toLowerCase();
  if (!HEX32.test(normalized) || (!allowZero && /^0x0{64}$/.test(normalized))) {
    throw new TypeError(`${label} must be canonical bytes32`);
  }
  return normalized as Hex;
}

function uint(value: unknown, label: string, positive = false): bigint {
  const parsed = typeof value === "bigint" ? value : typeof value === "string" && UINT.test(value) ? BigInt(value) : -1n;
  if (parsed < (positive ? 1n : 0n) || parsed > MAX_UINT256) throw new TypeError(`${label} must be a valid uint256`);
  return parsed;
}

function epoch(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 0xffff_ffff) throw new TypeError("epochId must be a positive uint32");
  return parsed;
}

function request(name: string, distributor: Address, args: readonly unknown[], value?: bigint): ContractWriteRequest {
  address(distributor, "TreasuryDistributor");
  return createContractWriteRequest({
    abi: v1Abis.TreasuryDistributorV1,
    address: distributor,
    functionName: name as never,
    args: args as never,
    ...(value === undefined ? {} : { value }),
  });
}

function approval(token: Address, distributor: Address, amount: bigint): ContractWriteRequest {
  address(token, "approval token");
  address(distributor, "TreasuryDistributor");
  uint(amount, "approval amount", true);
  return createContractWriteRequest({
    abi: v1Abis.TickerMemeTokenV1,
    address: token,
    functionName: "approve",
    args: [distributor, amount],
  });
}

export function buildRequestRoot(input: Readonly<{
  distributor: Address;
  marketId: Hex;
  epochId: number;
  serviceFeeAsset: Address;
  serviceFeeAmount: bigint;
}>): Readonly<{ request: ContractWriteRequest; approval?: ContractWriteRequest }> {
  const market = bytes32(input.marketId, "marketId");
  const id = epoch(input.epochId);
  const feeAsset = address(input.serviceFeeAsset, "serviceFeeAsset", true);
  const amount = uint(input.serviceFeeAmount, "serviceFeeAmount", true);
  const write = request("requestRoot", input.distributor, [market, id], feeAsset === ZERO_ADDRESS ? amount : undefined);
  return feeAsset === ZERO_ADDRESS
    ? Object.freeze({ request: write })
    : Object.freeze({ request: write, approval: approval(feeAsset, input.distributor, amount) });
}

export function buildTreasuryClaim(input: Readonly<{
  distributor: Address;
  expectedAccount: Address;
  proof: TreasuryClaimProof;
}>): ContractWriteRequest {
  const distributor = address(input.distributor, "TreasuryDistributor");
  const account = address(input.expectedAccount, "connected account");
  if (address(input.proof.distributor, "proof.distributor") !== distributor) throw new Error("proof distributor mismatch");
  if (address(input.proof.account, "proof.account") !== account) throw new Error("proof account is not the connected wallet");
  if (input.proof.chainId !== ROBINHOOD_CHAIN_ID || input.proof.executionSpecId !== "V1-TREASURY-EXEC-1") throw new Error("proof execution domain mismatch");
  const market = bytes32(input.proof.marketId, "proof.marketId");
  const id = epoch(input.proof.epochId);
  const leafIndex = uint(input.proof.leafIndex, "proof.leafIndex");
  const twab = uint(input.proof.twab, "proof.twab", true);
  const amount = uint(input.proof.amount, "proof.amount", true);
  const proof = input.proof.proof.map((item) => bytes32(item, "proof item", true));
  return request("claim", distributor, [market, id, leafIndex, account, twab, amount, proof]);
}

export function buildFinalizeRoot(distributor: Address, marketId: Hex, epochId: number): ContractWriteRequest {
  return request("finalizeRoot", distributor, [bytes32(marketId, "marketId"), epoch(epochId)]);
}

export function buildExpireRoot(distributor: Address, marketId: Hex, epochId: number): ContractWriteRequest {
  return request("expireRootRequest", distributor, [bytes32(marketId, "marketId"), epoch(epochId)]);
}

export function buildRolloverEpoch(distributor: Address, marketId: Hex, epochId: number): ContractWriteRequest {
  return request("rolloverExpiredEpoch", distributor, [bytes32(marketId, "marketId"), epoch(epochId)]);
}

export function buildWithdrawServiceCredit(distributor: Address, asset: Address): ContractWriteRequest {
  return request("withdrawServiceCredit", distributor, [address(asset, "service credit asset", true)]);
}

export function buildFundQuote(input: Readonly<{
  distributor: Address; marketId: Hex; quoteAsset: Address; amount: bigint; fundingId: Hex;
}>): Readonly<{ request: ContractWriteRequest; approval?: ContractWriteRequest }> {
  const market = bytes32(input.marketId, "marketId");
  const quote = address(input.quoteAsset, "quoteAsset", true);
  const amount = uint(input.amount, "amount", true);
  const fundingId = bytes32(input.fundingId, "fundingId");
  const write = request("fundQuoteTreasury", input.distributor, [market, amount, fundingId], quote === ZERO_ADDRESS ? amount : undefined);
  return quote === ZERO_ADDRESS
    ? Object.freeze({ request: write })
    : Object.freeze({ request: write, approval: approval(quote, input.distributor, amount) });
}

export function buildBurnMeme(input: Readonly<{
  distributor: Address; marketId: Hex; memeToken: Address; amount: bigint; burnId: Hex;
}>): Readonly<{ request: ContractWriteRequest; approval: ContractWriteRequest }> {
  const market = bytes32(input.marketId, "marketId");
  const meme = address(input.memeToken, "memeToken");
  const amount = uint(input.amount, "amount", true);
  const burnId = bytes32(input.burnId, "burnId");
  return Object.freeze({
    request: request("burnMeme", input.distributor, [market, amount, burnId]),
    approval: approval(meme, input.distributor, amount),
  });
}

export async function fetchTreasuryClaimProof(input: Readonly<{
  baseUrl: string; marketId: Hex; epochId: number; account: Address; fetcher?: typeof fetch;
}>): Promise<TreasuryClaimProof> {
  const market = bytes32(input.marketId, "marketId");
  const id = epoch(input.epochId);
  const account = address(input.account, "account");
  const url = new URL(`/v1/treasury/markets/${market}/epochs/${id}/claims/${account}`, input.baseUrl);
  const response = await (input.fetcher ?? fetch)(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Treasury proof service returned HTTP ${response.status}`);
  const raw = await response.json() as Record<string, unknown>;
  const proofRaw = raw.proof;
  if (!Array.isArray(proofRaw)) throw new Error("Treasury proof response is missing proof[]");
  const parsed: TreasuryClaimProof = Object.freeze({
    schema: raw.schema === "TICKERGARDEN_V1_TREASURY_CLAIM_PROOF_V1" ? raw.schema : (() => { throw new Error("Treasury proof schema mismatch"); })(),
    executionSpecId: raw.executionSpecId === "V1-TREASURY-EXEC-1" ? raw.executionSpecId : (() => { throw new Error("Treasury proof execution domain mismatch"); })(),
    chainId: raw.chainId === ROBINHOOD_CHAIN_ID ? ROBINHOOD_CHAIN_ID : (() => { throw new Error("Treasury proof chain mismatch"); })(),
    distributor: address(String(raw.distributor), "proof.distributor"),
    marketId: bytes32(String(raw.marketId), "proof.marketId"),
    epochId: epoch(raw.epochId),
    leafIndex: uint(raw.leafIndex, "proof.leafIndex"),
    account: address(String(raw.account), "proof.account"),
    twab: uint(raw.twab, "proof.twab", true),
    amount: uint(raw.amount, "proof.amount", true),
    merkleRoot: bytes32(String(raw.merkleRoot), "proof.merkleRoot"),
    datasetHash: bytes32(String(raw.datasetHash), "proof.datasetHash"),
    proof: Object.freeze(proofRaw.map((item) => bytes32(String(item), "proof item", true))),
  });
  if (parsed.marketId !== market || parsed.epochId !== id || parsed.account !== account) throw new Error("Treasury proof request identity mismatch");
  return parsed;
}
