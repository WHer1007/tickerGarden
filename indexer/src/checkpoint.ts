import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DecodedV2Event } from "./schema.ts";

export interface CanonicalBlock {
  readonly chainId: number;
  readonly number: bigint;
  readonly hash: string;
  readonly parentHash: string;
  readonly events: readonly DecodedV2Event[];
}

export interface IndexerCheckpoint {
  readonly schemaVersion: 1;
  readonly executionSpecId: "V2-EXEC-4";
  readonly chainId: number;
  readonly startBlock: bigint;
  readonly anchorParentHash: string;
  readonly blocks: readonly CanonicalBlock[];
}

export interface CheckpointStore {
  load(): Promise<IndexerCheckpoint | null>;
  save(checkpoint: IndexerCheckpoint): Promise<void>;
}

const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? { $tickerGardenBigInt: value.toString() } : value;

const bigintReviver = (_key: string, value: unknown): unknown => {
  if (
    typeof value === "object" && value !== null && Object.keys(value).length === 1 &&
    "$tickerGardenBigInt" in value && typeof value.$tickerGardenBigInt === "string"
  ) return BigInt(value.$tickerGardenBigInt);
  return value;
};

export function encodeCheckpoint(checkpoint: IndexerCheckpoint): string {
  return `${JSON.stringify(checkpoint, bigintReplacer, 2)}\n`;
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, bigintReplacer);
}

export function decodeCheckpoint(encoded: string): IndexerCheckpoint {
  const parsed: unknown = JSON.parse(encoded, bigintReviver);
  if (
    typeof parsed !== "object" || parsed === null || !("schemaVersion" in parsed) || parsed.schemaVersion !== 1 ||
    !("executionSpecId" in parsed) || parsed.executionSpecId !== "V2-EXEC-4"
  ) {
    throw new Error("unsupported or malformed V2 indexer checkpoint");
  }
  return parsed as IndexerCheckpoint;
}

export class JsonCheckpointStore implements CheckpointStore {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<IndexerCheckpoint | null> {
    try {
      return decodeCheckpoint(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(checkpoint: IndexerCheckpoint): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, encodeCheckpoint(checkpoint), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
