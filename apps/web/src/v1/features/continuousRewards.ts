import { DUAL_HOLDER_MODE } from './userClaims.ts';
import type { Hex } from "viem";


export const CONTINUOUS_HOLDER_REWARD_MODE =
  "0x3e3420b678dfb6bb37902afb6881366daecf47ade19a6db2bc7ba2fe851cac44" as Hex;
export const CONFIGURABLE_HOLDER_REWARD_MODE =
  "0xe2725510c3342e3c80942dac32f322f9a94bc94a44cde91d1bca099c31ac2161" as Hex;
export const BATCHED_HOLDER_REWARD_MODE =
  "0x4a2b62eb58c5d21a8a49ea6b8cc61212bada7b6bf612d3a606fb2f892b19db9f" as Hex;

export const HOLDER_REWARDS_DISTRIBUTOR_V1_ABI = [
  { type: "function", name: "releaseState", inputs: [{name:"id", type:"bytes32"}], outputs: [{name:"unreleased",type:"uint256"},{name:"idleQuote",type:"uint256"},{name:"nextEnd",type:"uint64"},{name:"activeStreams",type:"uint256"}], stateMutability:"view" },
  { type: "function", name: "lastFundingAt", inputs: [{type:"bytes32"}], outputs: [{type:"uint64"}], stateMutability:"view" },
  { type: "function", name: "rewardMode", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "pure" },
  { type: "function", name: "claimable", inputs: [{ name: "id", type: "bytes32" }, { name: "user", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
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

export function isContinuousHolderRewardMode(value: unknown): value is Hex {
  return typeof value === "string" && [CONTINUOUS_HOLDER_REWARD_MODE, BATCHED_HOLDER_REWARD_MODE, CONFIGURABLE_HOLDER_REWARD_MODE, DUAL_HOLDER_MODE].includes(value.toLowerCase() as Hex);
}
