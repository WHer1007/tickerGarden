import fs from "node:fs";
import { encodeFunctionData } from "../../../apps/web/node_modules/viem/_esm/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeEligibilityPolicyHash,
  generateTreasuryRoot,
} from "../testsupport/treasury-reference.ts";

const ZERO = "0x0000000000000000000000000000000000000000";
const DISTRIBUTOR = "0x1000000000000000000000000000000000000001";
const MEME = "0x2000000000000000000000000000000000000002";
const QUOTE = "0x3000000000000000000000000000000000000003";
const SYSTEM = "0x4000000000000000000000000000000000000004";
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const D = "0x00000000000000000000000000000000000000d4";
const MARKET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DAY = 86400n;
const WINDOW_START = 1_700_000_000n;
const WINDOW_END = WINDOW_START + 7n * DAY;
const SOURCE_BLOCK = 10_000n;
const SOURCE_TIME = WINDOW_END + 123n;
const SOURCE_HASH = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function transfer(blockNumber, transactionIndex, logIndex, timestamp, from, to, value) {
  return { blockNumber: BigInt(blockNumber), transactionIndex, logIndex, timestamp: BigInt(timestamp), from, to, value: BigInt(value) };
}

function input(epochId, quoteAmount, transfers, excludedAccounts = [ZERO, SYSTEM], emptyEpochPolicy) {
  const eligibilityPolicyHash = computeEligibilityPolicyHash(1n, MARKET, excludedAccounts);
  return {
    ...(emptyEpochPolicy ? { emptyEpochPolicy } : {}),
    chainId: 1n, distributor: DISTRIBUTOR, marketId: MARKET, memeToken: MEME, quoteToken: QUOTE,
    eligibilityPolicyHash, excludedAccounts, epochId, windowStart: WINDOW_START, windowEnd: WINDOW_END,
    sourceBlockNumber: SOURCE_BLOCK, sourceBlockHash: SOURCE_HASH, sourceBlockTimestamp: SOURCE_TIME,
    quoteAmount: BigInt(quoteAmount), transfers,
  };
}

const cases = [
  {
    name: "single-user",
    input: input(1, 1000n, [transfer(1, 0, 0, WINDOW_START - 1n, ZERO, A, 100n)]),
  },
  {
    name: "three-user-odd-tree-max-remainder-tie",
    input: input(2, 10n, [
      transfer(1, 0, 0, WINDOW_START - 3n, ZERO, A, 1n),
      transfer(2, 0, 0, WINDOW_START - 2n, ZERO, B, 1n),
      transfer(3, 0, 0, WINDOW_START - 1n, ZERO, C, 1n),
    ]),
  },
  {
    name: "mid-window-transfer-burn-self-transfer",
    input: input(3, 100n, [
      transfer(1, 0, 0, WINDOW_START - 1n, ZERO, A, 100n),
      transfer(2, 0, 0, WINDOW_START + 2n * DAY, A, B, 40n),
      transfer(3, 0, 0, WINDOW_START + 3n * DAY, B, ZERO, 10n),
      transfer(4, 0, 0, WINDOW_START + 4n * DAY, A, A, 5n),
    ]),
  },
  {
    name: "zero-amount-allocation-filter",
    input: input(4, 1n, [
      transfer(1, 0, 0, WINDOW_START - 1n, ZERO, A, 1n),
      transfer(2, 0, 0, WINDOW_START - 1n, ZERO, B, 1n),
      transfer(3, 0, 0, WINDOW_START - 1n, ZERO, C, 1n),
    ]),
  },
  {
    name: "reviewed-rollover-empty-eligibility",
    input: input(5, 777n, [transfer(1, 0, 0, WINDOW_START - 1n, ZERO, SYSTEM, 100n)], [ZERO, SYSTEM], "reviewed-rollover"),
  },
  {
    name: "maxuint256-quote-allocation",
    input: input(6, (1n << 256n) - 1n, [
      transfer(1, 0, 0, WINDOW_START - 1n, ZERO, A, 1n),
      transfer(2, 0, 0, WINDOW_START - 1n, ZERO, B, 2n),
    ]),
  },
];

function serialize(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  return value;
}

const abi = JSON.parse(fs.readFileSync(new URL("../../../contracts/out-v1/IV1Protocol.sol/ITreasuryDistributorV1.json", import.meta.url), "utf8")).abi;
const golden = { cases: cases.map(({ name, input: value }) => {
  const output = generateTreasuryRoot(value);
  const publicationData = encodeFunctionData({ abi, functionName: "publishRoot", args: [value.marketId, value.epochId, output.merkleRoot, output.datasetHash, BigInt(output.totalTwab), output.leafCount, BigInt(output.totalAllocated)] });
  const finalizeData = encodeFunctionData({ abi, functionName: "finalizeRoot", args: [value.marketId, value.epochId] });
  const cancelData = encodeFunctionData({ abi, functionName: "cancelPendingRoot", args: [value.marketId, value.epochId, output.datasetHash] });
  return { name, input: serialize(value), output: serialize(output), publicationData, finalizeData, cancelData };
}) };
const outputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../internal/treasury/testdata/golden.json");
const rendered = `${JSON.stringify(golden, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const existing = fs.readFileSync(outputPath, "utf8");
  if (existing !== rendered) throw new Error(`${outputPath} differs; regenerate without --check`);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered);
}
