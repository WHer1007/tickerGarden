import type { Address, Hex } from "viem";
import { createContractWriteRequest, type ContractWriteRequest } from "../transaction.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;

export const CONTINUOUS_HOLDER_REWARD_MODE =
  "0x3e3420b678dfb6bb37902afb6881366daecf47ade19a6db2bc7ba2fe851cac44" as Hex;

export const HOLDER_REWARDS_DISTRIBUTOR_V1_ABI = [
  { type: "function", name: "releaseState", inputs: [{name:"id", type:"bytes32"}], outputs: [{name:"unreleased",type:"uint256"},{name:"idleQuote",type:"uint256"},{name:"nextEnd",type:"uint64"},{name:"activeStreams",type:"uint256"}], stateMutability:"view" },
  { type: "function", name: "lastFundingAt", inputs: [{type:"bytes32"}], outputs: [{type:"uint64"}], stateMutability:"view" },
  { type: "function", name: "rewardMode", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "pure" },
  { type: "function", name: "claimable", inputs: [{ name: "id", type: "bytes32" }, { name: "user", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "claim", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "marketState", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ type: "tuple", components: [
    { name: "token", type: "address" }, { name: "quote", type: "address" }, { name: "vault", type: "address" },
    { name: "updatedAt", type: "uint64" }, { name: "head", type: "uint8" }, { name: "count", type: "uint8" },
    { name: "supply", type: "uint256" }, { name: "index", type: "uint256" }, { name: "indexRemainder", type: "uint256" },
    { name: "rate", type: "uint256" }, { name: "idle", type: "uint256" }, { name: "funded", type: "uint256" }, { name: "paid", type: "uint256" },
  ] }], stateMutability: "view" },
  { type: "event", name: "HolderStreamClaimed", inputs: [
    { name: "marketId", type: "bytes32", indexed: true }, { name: "account", type: "address", indexed: true },
    { name: "asset", type: "address", indexed: false }, { name: "amount", type: "uint256", indexed: false },
  ], anonymous: false },
] as const;

function address(value: string, label: string): Address {
  const normalized = value.toLowerCase();
  if (!ADDRESS.test(normalized) || /^0x0{40}$/.test(normalized)) throw new TypeError(`${label} must be a non-zero address`);
  return normalized as Address;
}

function marketId(value: string): Hex {
  const normalized = value.toLowerCase();
  if (!HEX32.test(normalized) || /^0x0{64}$/.test(normalized)) throw new TypeError("marketId must be a non-zero bytes32");
  return normalized as Hex;
}

export function buildContinuousHolderClaim(input: Readonly<{ distributor: Address; marketId: Hex }>): ContractWriteRequest {
  return createContractWriteRequest({
    abi: HOLDER_REWARDS_DISTRIBUTOR_V1_ABI,
    address: address(input.distributor, "HolderRewardsDistributor"),
    functionName: "claim",
    args: [marketId(input.marketId)],
  });
}

export function isContinuousHolderRewardMode(value: unknown): value is Hex {
  return typeof value === "string" && value.toLowerCase() === CONTINUOUS_HOLDER_REWARD_MODE;
}
