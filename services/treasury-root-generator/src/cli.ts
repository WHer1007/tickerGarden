import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { generateTreasuryRoot, type TransferObservation, type TreasuryRootInput } from "./index.js";

function parseInput(value: unknown): TreasuryRootInput {
  if (typeof value !== "object" || value === null) throw new Error("input must be an object");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.transfers) || !Array.isArray(input.excludedAccounts)) {
    throw new Error("transfers and excludedAccounts must be arrays");
  }
  return {
    chainId: BigInt(String(input.chainId)),
    distributor: String(input.distributor) as TreasuryRootInput["distributor"],
    marketId: String(input.marketId) as TreasuryRootInput["marketId"],
    memeToken: String(input.memeToken) as TreasuryRootInput["memeToken"],
    quoteToken: String(input.quoteToken) as TreasuryRootInput["quoteToken"],
    eligibilityPolicyHash: String(input.eligibilityPolicyHash) as TreasuryRootInput["eligibilityPolicyHash"],
    excludedAccounts: input.excludedAccounts.map(String) as TreasuryRootInput["excludedAccounts"],
    epochId: Number(input.epochId),
    windowStart: BigInt(String(input.windowStart)),
    windowEnd: BigInt(String(input.windowEnd)),
    sourceBlockNumber: BigInt(String(input.sourceBlockNumber)),
    sourceBlockHash: String(input.sourceBlockHash) as TreasuryRootInput["sourceBlockHash"],
    sourceBlockTimestamp: BigInt(String(input.sourceBlockTimestamp)),
    quoteAmount: BigInt(String(input.quoteAmount)),
    transfers: input.transfers.map((entry) => {
      const transfer = entry as Record<string, unknown>;
      return {
        blockNumber: BigInt(String(transfer.blockNumber)),
        transactionIndex: Number(transfer.transactionIndex),
        logIndex: Number(transfer.logIndex),
        timestamp: BigInt(String(transfer.timestamp)),
        from: String(transfer.from),
        to: String(transfer.to),
        value: BigInt(String(transfer.value)),
      } as TransferObservation;
    }),
  };
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, (_, field) => (typeof field === "bigint" ? field.toString() : field), 2)}\n`;
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  throw new Error("usage: treasury-root-generator <input.json> <output.json>");
}

const input = parseInput(JSON.parse(await readFile(inputPath, "utf8")));
const output = generateTreasuryRoot(input);
await writeFile(outputPath, stringify(output), "utf8");
