import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { findCanonicalMarketCreated, type CreateMarketParams } from "../src/v2/features/launch.ts";
import { v2Abis } from "../src/v2/generated/abis.ts";

const address = (value: string): Address => `0x${value.padStart(40, "0")}`;
const hash = (value: string): Hex => `0x${value.padStart(64, "0")}`;
const factory = address("f1");
const memeToken = address("a1");
const curve = address("a2");
const gauge = address("a3");
const quoteAsset = address("a4");
const params: CreateMarketParams = {
  assetUid: hash("11"),
  ponsBaselineId: hash("12"),
  quoteAssetConfigId: hash("13"),
  launchTemplateId: hash("14"),
  expectedEconomics: hash("15"),
  creatorRevenueBeneficiary: address("b1"),
  name: "Ticker Garden",
  symbol: "TGRDN",
  metadataURI: "ipfs://ticker-garden",
  salt: hash("16"),
};

function marketCreatedLog(overrides: Readonly<{
  emitter?: Address;
  assetUid?: Hex;
  quote?: Address;
}> = {}) {
  return {
    address: overrides.emitter ?? factory,
    topics: encodeEventTopics({
      abi: v2Abis.TickerGardenFactoryV2,
      eventName: "MarketCreated",
      args: { marketId: hash("21"), assetUid: overrides.assetUid ?? params.assetUid, memeToken },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("address curve, address gauge, address quoteAsset, bytes32 ponsBaselineId, bytes32 quoteAssetConfigId, bytes32 expectedEconomics"),
      [curve, gauge, overrides.quote ?? quoteAsset, params.ponsBaselineId, params.quoteAssetConfigId, params.expectedEconomics],
    ),
  };
}

test("accepts only the exact canonical Factory MarketCreated event", () => {
  const receipt = { logs: [marketCreatedLog()] } as unknown as Pick<TransactionReceipt, "logs">;
  assert.deepEqual(findCanonicalMarketCreated(receipt, factory, { params, quoteAsset }), {
    marketId: hash("21"), memeToken, curve, gauge,
  });
});

test("rejects spoofed emitters and launch-parameter drift", () => {
  const spoofed = { logs: [marketCreatedLog({ emitter: address("f2") })] } as unknown as Pick<TransactionReceipt, "logs">;
  assert.throws(() => findCanonicalMarketCreated(spoofed, factory, { params, quoteAsset }), /expected canonical Factory/);

  const drifted = { logs: [marketCreatedLog({ assetUid: hash("99") })] } as unknown as Pick<TransactionReceipt, "logs">;
  assert.throws(() => findCanonicalMarketCreated(drifted, factory, { params, quoteAsset }), /expected canonical Factory/);
});
