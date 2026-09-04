import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import {
  assertFinalizedSync,
  canonicalAddress,
  canonicalBytes32,
  foldSortedMerkleProof,
  minimumAfterSlippage,
  parseSlippageBps,
  parseTokenAmount,
  parseUint32,
  phaseLabel,
} from "../src/runtime/model.ts";
import type { SyncStatus } from "../src/v1/readApi.ts";
import { parseV1RuntimeConfig, V1_TREASURY_RELEASE_APPROVAL } from "../src/v1/runtimeConfig.ts";
import { assertCanonicalMarketBinding, decodeCanonicalFactoryBindings } from "../src/v1/chainBindings.ts";
import { V1_EXECUTION_SPEC_ID } from "../src/v1/generated/abis.ts";
import { deriveCreateMarketParams } from "../src/v1/features/launch.ts";
import { buildVaultView } from "../src/v1/features/vault.ts";
import { buildClaimCreator, buildTransferCreatorBeneficiary } from "../src/v1/features/creator.ts";
import {
  buildBurnMeme,
  buildFundQuote,
  buildRequestRoot,
  buildTreasuryClaim,
  buildWithdrawServiceCredit,
  fetchTreasuryClaimProof,
} from "../src/v1/features/treasury.ts";

const addr = (digit: string): Address => `0x${digit.repeat(40)}` as Address;
const bytes32 = (digit: string): Hex => `0x${digit.repeat(64)}` as Hex;
const market = bytes32("a");
const zeroAddress = `0x${"0".repeat(40)}` as Address;

function canonicalMarketFixture() {
  const quoteAsset = addr("1");
  const memeToken = addr("2");
  const hook = addr("3");
  const key = [quoteAsset, memeToken, 0, 60, hook] as const;
  const poolId = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [...key],
  ));
  const api = {
    marketId: market, assetUid: bytes32("1"), memeToken, curve: addr("4"), gauge: addr("5"), quoteAsset,
    quoteAssetConfigId: bytes32("6"), ponsBaselineId: bytes32("7"), sourceVersion: 1, launchPhase: 0,
    curveProgress: { sweptAt: null }, poolId: null, poolKey: null,
    canonicalRoute: { router: addr("8"), quoter: addr("9"), hook, launchLocker: addr("a"), graduationExecutor: addr("b"), curveTradingEnabled: true, poolTradingEnabled: false, sourceVersion: 1, launchPhase: 0 },
  } as const;
  const rawMarket = {
    config: [api.assetUid, api.ponsBaselineId, api.quoteAssetConfigId, bytes32("c"), bytes32("d"), bytes32("e"), bytes32("f"), 0n, addr("c"), memeToken, api.curve, api.gauge, quoteAsset, hook],
    runtime: { poolId: bytes32("0"), sourceVersion: 1, sweptAt: 0n, launchPhase: 0 },
  } as const;
  const rawRoute = [key, poolId, api.canonicalRoute.router, api.canonicalRoute.quoter, hook, quoteAsset, memeToken, api.gauge, api.curve, api.canonicalRoute.launchLocker, 1, 0, 0, true, false] as const;
  return { api, rawMarket, rawRoute, poolId, key };
}

test("model parsers accept exact decimal amounts and reject unsafe input", () => {
  assert.equal(parseTokenAmount("1.25", 2, "amount"), 125n);
  assert.equal(parseTokenAmount("0.000001", 6, "amount"), 1n);
  assert.throws(() => parseTokenAmount("1.001", 2, "amount"), /decimal places/);
  assert.throws(() => parseTokenAmount("+1", 18, "amount"), /plain positive/);
  assert.throws(() => parseTokenAmount("0", 18, "amount"), /positive/);
  assert.equal(parseUint32("4294967295", "epoch"), 0xffff_ffff);
  assert.throws(() => parseUint32("0", "epoch"), /positive/);
  assert.throws(() => parseUint32("4294967296", "epoch"), /uint32/);
  assert.equal(parseSlippageBps("5000"), 5000);
  assert.throws(() => parseSlippageBps("5001"), /between 0 and 5000/);
  assert.equal(minimumAfterSlippage(1_000n, 125), 987n);
  assert.throws(() => minimumAfterSlippage(0n, 0), /positive/);
});

test("canonical identifiers and finalized Robinhood snapshot are fail-closed", () => {
  assert.equal(canonicalAddress(addr("1").toUpperCase(), "token"), addr("1"));
  assert.equal(canonicalBytes32(bytes32("b").toUpperCase(), "market"), bytes32("b"));
  assert.throws(() => canonicalAddress(`0x${"0".repeat(40)}`, "token"), /non-zero/);
  assert.throws(() => canonicalBytes32(`0x${"0".repeat(64)}`, "market"), /non-zero/);
  const sync: SyncStatus = {
    chainId: 4663, status: "synced", finality: "finalized", blockNumber: "42",
    blockHash: bytes32("c"), headBlockNumber: "42", headBlockHash: bytes32("c"), lagBlocks: "0",
    revision: `42:${bytes32("c")}`,
  };
  assert.doesNotThrow(() => assertFinalizedSync(sync));
  assert.throws(() => assertFinalizedSync({ ...sync, chainId: 1 } as unknown as SyncStatus), /Robinhood/);
  assert.equal(phaseLabel(0), "Curve");
  assert.equal(phaseLabel(99), "Phase 99");
});

test("Treasury proof folding uses canonical sorted-pair Merkle hashing", () => {
  const leaf = `0x${"11".repeat(32)}` as Hex;
  const sibling = `0x${"22".repeat(32)}` as Hex;
  const expected = "0x3e92e0db88d6afea9edc4eedf62fffa4d92bcdfc310dccbe943747fe8302e871";
  assert.equal(foldSortedMerkleProof(leaf, [sibling]), expected);
  assert.equal(foldSortedMerkleProof(sibling, [leaf]), expected);
  assert.throws(() => foldSortedMerkleProof(leaf, ["0x1234" as Hex]), /proof item/);
});

const validEnv = {
  VITE_V1_READ_API_URL: "https://api.example.test/",
  VITE_V1_TREASURY_PROOF_API_URL: "https://proof.example.test/",
  VITE_V1_FACTORY_ADDRESS: addr("1"),
  VITE_V1_LAUNCH_ROUTER_ADDRESS: addr("2"),
  VITE_V1_ALLOCATION_MANAGER_ADDRESS: addr("3"),
  VITE_V1_PROTOCOL_FEE_VAULT_ADDRESS: addr("4"),
  VITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS: addr("5"),
  VITE_V1_TREASURY_DISTRIBUTOR_ADDRESS: addr("6"),
  VITE_V1_TREASURY_RELEASE_APPROVAL: V1_TREASURY_RELEASE_APPROVAL,
};

test("runtime capabilities are independently parsed and never use a demo fallback", () => {
  const parsed = parseV1RuntimeConfig(validEnv);
  assert.equal(parsed.readApi.available, true);
  assert.equal(parsed.contracts.available, true);
  assert.equal(parsed.treasuryProofApi.available, true);
  assert.equal(parsed.treasuryWrites.available, true);
  if (parsed.contracts.available) assert.equal(parsed.contracts.value.treasuryDistributorAddress, addr("6"));
  const partial = parseV1RuntimeConfig({ ...validEnv, VITE_V1_TREASURY_PROOF_API_URL: undefined });
  assert.equal(partial.readApi.available, true);
  assert.equal(partial.contracts.available, true);
  assert.equal(partial.treasuryProofApi.available, false);
  assert.ok(partial.reasons.some((reason) => reason.includes("TREASURY_PROOF_API_URL")));
  const treasuryLocked = parseV1RuntimeConfig({ ...validEnv, VITE_V1_TREASURY_RELEASE_APPROVAL: undefined });
  assert.equal(treasuryLocked.contracts.available, true);
  assert.equal(treasuryLocked.treasuryWrites.available, false);
  assert.ok(!treasuryLocked.reasons.some((reason) => reason.includes("TREASURY_RELEASE_APPROVAL")));
  const emergencyOnly = parseV1RuntimeConfig({ VITE_V1_FACTORY_ADDRESS: addr("1") });
  assert.equal(emergencyOnly.contracts.available, false);
  assert.equal(emergencyOnly.rageQuitFactory.available, true);
  assert.equal(parseV1RuntimeConfig({ ...validEnv, VITE_V1_FACTORY_ADDRESS: addr("1").toUpperCase() }).contracts.available, false);
});

test("frontend execution and rageQuit configuration stay on the current V1 contract", () => {
  assert.equal(V1_EXECUTION_SPEC_ID, "V1-EXEC-8");
  const emergencyOnly = parseV1RuntimeConfig({ VITE_V1_FACTORY_ADDRESS: addr("1") });
  assert.equal(emergencyOnly.rageQuitFactory.available, true);
  assert.equal(emergencyOnly.rageQuitFactory.available && emergencyOnly.rageQuitFactory.value, addr("1"));
});

test("launch and vault gates fail closed while preserving principal exit", () => {
  const config = {
    asset: { assetUid: bytes32("1"), status: 1 },
    quote: { configId: bytes32("2"), economicsHash: bytes32("2"), quoteAsset: zeroAddress, ponsBaselineId: bytes32("3"), status: 1 },
    pons: { baselineId: bytes32("3"), status: 1 }, template: { templateId: bytes32("4"), status: 1 },
    creatorRevenueBeneficiary: addr("5"), name: "Test", symbol: "TEST", metadataURI: "ipfs://test", salt: bytes32("6"),
  } as const;
  assert.equal(deriveCreateMarketParams(config).expectedEconomics, `0x${"0".repeat(64)}`);
  assert.throws(() => deriveCreateMarketParams({ ...config, asset: { ...config.asset, status: 2 } }), /asset must be ACTIVE/);
  const source = { chainId: 4663, blockNumber: "10", blockHash: bytes32("7"), transactionHash: bytes32("8"), transactionIndex: 0, logIndex: 0 };
  const marketModel = { marketId: market, assetUid: bytes32("1"), memeToken: addr("9"), quoteAsset: zeroAddress, curve: addr("a"), gauge: addr("b"), launchPhase: 0, source };
  const position = { marketId: market, assetUid: bytes32("1"), user: addr("c"), free: "0", allocated: "10", pending: "0", active: "10", unlockAt: "9999999999", claimable: [{ asset: zeroAddress, amount: "0" }, { asset: addr("9"), amount: "0" }], source };
  const view = buildVaultView(marketModel as never, position as never, { executionSpecId: "V1-EXEC-8", revision: `10:${bytes32("7")}`, syncStatus: "synced" }, { status: 3, tokenDecimals: 18, minimumAllocation: 414n }, 0n);
  assert.equal(view.allocationOpen, false);
  assert.equal(view.canRageQuit, true);
});

test("independent escape decodes the immutable Factory registry graph without read API data", () => {
  const bindings = decodeCanonicalFactoryBindings([
    addr("1"), addr("2"), addr("3"), addr("4"), addr("5"), addr("6"), addr("7"), addr("8"),
  ]);
  assert.equal(bindings.officialStockRegistry, addr("1"));
  assert.equal(bindings.marketRegistry, addr("5"));
  assert.equal(bindings.allocationManager, addr("7"));
  assert.equal(bindings.launchRouter, addr("8"));
  assert.throws(
    () => decodeCanonicalFactoryBindings([addr("1"), addr("2")]),
    /Factory\.ponsBaselineRegistry/,
  );
});

test("canonical market binding accepts Curve API null pool fields with a valid expected pool route", () => {
  const fixture = canonicalMarketFixture();
  assert.doesNotThrow(() => assertCanonicalMarketBinding(fixture.api as never, fixture.rawMarket, fixture.rawRoute));
});

test("canonical market binding rejects pool key hash and key invariant drift", () => {
  const fixture = canonicalMarketFixture();
  assert.throws(() => assertCanonicalMarketBinding(fixture.api as never, fixture.rawMarket, [fixture.rawRoute[0], bytes32("f"), ...fixture.rawRoute.slice(2)]), /keccak256/);
  const wrongKey = [fixture.key[1], fixture.key[0], fixture.key[2], fixture.key[3], fixture.key[4]] as const;
  const wrongKeyRoute = [wrongKey, fixture.poolId, ...fixture.rawRoute.slice(2)] as const;
  assert.throws(() => assertCanonicalMarketBinding(fixture.api as never, fixture.rawMarket, wrongKeyRoute), /currency0 Quote\/Meme ordering/);
});

test("canonical market binding rejects inconsistent API pool nullability", () => {
  const fixture = canonicalMarketFixture();
  const api = { ...fixture.api, poolId: fixture.poolId };
  const rawMarket = { ...fixture.rawMarket, runtime: { ...fixture.rawMarket.runtime, poolId: fixture.poolId } };
  assert.throws(() => assertCanonicalMarketBinding(api as never, rawMarket, fixture.rawRoute), /nullability/);
});

test("creator builders encode canonical beneficiary and claim operations", () => {
  const claim = buildClaimCreator({ feeVault: addr("4"), marketId: market, epoch: 7, asset: addr("7") });
  assert.equal(claim.functionName, "claimCreator");
  assert.deepEqual(claim.args, [market, 7, addr("7")]);
  const transfer = buildTransferCreatorBeneficiary({ registry: addr("5"), marketId: market, nextBeneficiary: addr("8") });
  assert.equal(transfer.functionName, "transferCreatorRevenueBeneficiary");
  assert.deepEqual(transfer.args, [market, addr("8")]);
  assert.throws(() => buildClaimCreator({ feeVault: addr("4"), marketId: market, epoch: 0, asset: addr("7") }), /epoch/);
  assert.throws(() => buildTransferCreatorBeneficiary({ registry: addr("5"), marketId: market.toUpperCase() as Hex, nextBeneficiary: addr("8") }), /lowercase/);
});

test("Treasury root funding distinguishes native value from ERC-20 approval", () => {
  const native = buildRequestRoot({ distributor: addr("6"), marketId: market, epochId: 3, serviceFeeAsset: `0x${"0".repeat(40)}` as Address, serviceFeeAmount: 99n });
  assert.equal(native.request.functionName, "requestRoot");
  assert.equal(native.request.value, 99n);
  assert.equal(native.approval, undefined);
  const erc20 = buildFundQuote({ distributor: addr("6"), marketId: market, quoteAsset: addr("9"), amount: 12n, fundingId: bytes32("d") });
  assert.equal(erc20.request.functionName, "fundQuoteTreasury");
  assert.equal(erc20.request.value, undefined);
  assert.equal(erc20.approval?.functionName, "approve");
  assert.deepEqual(erc20.approval?.args, [addr("6"), 12n]);
  const burn = buildBurnMeme({ distributor: addr("6"), marketId: market, memeToken: addr("a"), amount: 2n, burnId: bytes32("e") });
  assert.equal(burn.request.functionName, "burnMeme");
  assert.equal(burn.approval?.address, addr("a"));
  const withdraw = buildWithdrawServiceCredit(addr("6"), `0x${"0".repeat(40)}` as Address);
  assert.equal(withdraw.functionName, "withdrawServiceCredit");
  assert.deepEqual(withdraw.args, [`0x${"0".repeat(40)}`]);
});

test("Treasury claims bind proof schema, domain, distributor, market, epoch, and wallet", () => {
  const proof = {
    schema: "TICKERGARDEN_V1_TREASURY_CLAIM_PROOF_V1",
    executionSpecId: "V1-TREASURY-EXEC-1", chainId: 4663,
    distributor: addr("6"), marketId: market, epochId: 3, leafIndex: 0n,
    account: addr("b"), twab: 10n, amount: 5n, merkleRoot: bytes32("f"), datasetHash: bytes32("1"), proof: [bytes32("2")],
  } as const;
  const claim = buildTreasuryClaim({ distributor: addr("6"), expectedAccount: addr("b"), proof });
  assert.equal(claim.functionName, "claim");
  assert.deepEqual(claim.args, [market, 3, 0n, addr("b"), 10n, 5n, [bytes32("2")]]);
  assert.throws(() => buildTreasuryClaim({ distributor: addr("6"), expectedAccount: addr("c"), proof }), /connected wallet/);
  assert.throws(() => buildTreasuryClaim({ distributor: addr("7"), expectedAccount: addr("b"), proof }), /distributor mismatch/);
});

test("proof fetch validates response schema without making a network request", async () => {
  const payload = {
    schema: "TICKERGARDEN_V1_TREASURY_CLAIM_PROOF_V1", executionSpecId: "V1-TREASURY-EXEC-1", chainId: 4663,
    distributor: addr("6"), marketId: market, epochId: 3, leafIndex: "0", account: addr("b"), twab: "10", amount: "5",
    merkleRoot: bytes32("f"), datasetHash: bytes32("1"), proof: [bytes32("2")],
  };
  let requested = "";
  const fetcher: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchTreasuryClaimProof({ baseUrl: "https://proof.example.test/", marketId: market, epochId: 3, account: addr("b"), fetcher });
  assert.equal(result.amount, 5n);
  assert.equal(new URL(requested).pathname, `/v1/treasury/markets/${market}/epochs/3/claims/${addr("b")}`);
  await assert.rejects(fetchTreasuryClaimProof({ baseUrl: "https://proof.example.test/", marketId: market, epochId: 3, account: addr("b"), fetcher: async () => new Response(JSON.stringify({ ...payload, chainId: 1 }), { status: 200 }) }), /chain mismatch/);
});
