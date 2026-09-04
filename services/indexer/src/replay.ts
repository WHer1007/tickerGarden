import { isDeepStrictEqual } from "node:util";
import type { CanonicalBlock, CheckpointStore, IndexerCheckpoint } from "./checkpoint.ts";
import { encodeCheckpoint, encodeJson } from "./checkpoint.ts";
import { applyV1Event } from "./projector.ts";
import { createIndexerState, type V1IndexerState } from "./schema.ts";

const lower = (value: string): string => value.toLowerCase();

function validateBlock(block: CanonicalBlock): void {
  const seen = new Set<string>();
  let lastLogIndex = -1;
  for (const event of block.events) {
    if (event.chainId !== block.chainId || event.blockNumber !== block.number || lower(event.blockHash) !== lower(block.hash)) {
      throw new Error(`event metadata does not match canonical block ${block.number}`);
    }
    if (event.logIndex < lastLogIndex) throw new Error(`events are not log ordered in block ${block.number}`);
    const identity = `${lower(event.transactionHash)}:${event.logIndex}`;
    if (seen.has(identity) && !isDeepStrictEqual(block.events.find((candidate) =>
      lower(candidate.transactionHash) === lower(event.transactionHash) && candidate.logIndex === event.logIndex,
    ), event)) throw new Error(`conflicting duplicate event ${identity}`);
    seen.add(identity);
    lastLogIndex = event.logIndex;
  }
}

function rebuild(blocks: readonly CanonicalBlock[]): V1IndexerState {
  const state = createIndexerState();
  for (const block of blocks) for (const event of block.events) applyV1Event(state, event);
  return state;
}

export class CanonicalReplayEngine {
  #blocks: CanonicalBlock[] = [];
  #state: V1IndexerState = createIndexerState();
  readonly chainId: number;
  readonly startBlock: bigint;
  readonly anchorParentHash: string;
  readonly store: CheckpointStore | undefined;

  constructor(
    chainId: number,
    startBlock: bigint,
    anchorParentHash: string,
    store?: CheckpointStore,
  ) {
    this.chainId = chainId;
    this.startBlock = startBlock;
    this.anchorParentHash = anchorParentHash;
    this.store = store;
  }

  get state(): V1IndexerState { return this.#state; }
  get blocks(): readonly CanonicalBlock[] { return this.#blocks; }
  get tip(): CanonicalBlock | undefined { return this.#blocks.at(-1); }

  static async restore(store: CheckpointStore): Promise<CanonicalReplayEngine | null> {
    const checkpoint = await store.load();
    if (!checkpoint) return null;
    const engine = new CanonicalReplayEngine(
      checkpoint.chainId, checkpoint.startBlock, checkpoint.anchorParentHash, store,
    );
    await engine.acceptBranch(checkpoint.blocks, false);
    return engine;
  }

  checkpoint(): IndexerCheckpoint {
    return {
      schemaVersion: 1, executionSpecId: "V1-EXEC-10", chainId: this.chainId, startBlock: this.startBlock,
      anchorParentHash: this.anchorParentHash, blocks: this.#blocks,
    };
  }

  canonicalBytes(): string {
    return encodeCheckpoint(this.checkpoint());
  }

  canonicalStateBytes(): string {
    const sorted = <Value>(map: ReadonlyMap<string, Value>): readonly (readonly [string, Value])[] =>
      [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
    return encodeJson({
      events: sorted(this.#state.events), configs: sorted(this.#state.configs), markets: sorted(this.#state.markets),
      pools: sorted(this.#state.pools), poolEvents: sorted(this.#state.poolEvents), curveTrades: sorted(this.#state.curveTrades),
      stockPositions: sorted(this.#state.stockPositions), allocations: sorted(this.#state.allocations),
      activationBuckets: sorted(this.#state.activationBuckets), gaugePositions: sorted(this.#state.gaugePositions),
      feeCredits: sorted(this.#state.feeCredits), feeClaims: sorted(this.#state.feeClaims),
      swaps: sorted(this.#state.swaps),
      observations: sorted(this.#state.observations), lastPosition: this.#state.lastPosition,
    });
  }

  async acceptBranch(branch: readonly CanonicalBlock[], persist = true): Promise<"applied" | "duplicate"> {
    if (branch.length === 0) return "duplicate";
    const next = [...this.#blocks];
    let changed = false;

    for (const block of branch) {
      validateBlock(block);
      if (block.chainId !== this.chainId) throw new Error(`unexpected chain ${block.chainId}`);
      const existingIndex = next.findIndex(({ number }) => number === block.number);
      if (existingIndex >= 0 && lower(next[existingIndex]!.hash) === lower(block.hash)) {
        if (!isDeepStrictEqual(next[existingIndex], block)) throw new Error(`canonical block payload conflict at ${block.number}`);
        continue;
      }

      const expectedParent = block.number === this.startBlock
        ? this.anchorParentHash
        : next.find(({ number }) => number === block.number - 1n)?.hash;
      if (!expectedParent || lower(expectedParent) !== lower(block.parentHash)) {
        throw new Error(`branch does not connect to a known common ancestor at ${block.number}`);
      }
      if (existingIndex >= 0) next.splice(existingIndex);
      const expectedNumber = next.length === 0 ? this.startBlock : next.at(-1)!.number + 1n;
      if (block.number !== expectedNumber) throw new Error(`non-contiguous canonical block ${block.number}`);
      next.push(block);
      changed = true;
    }

    if (!changed) return "duplicate";
    const nextState = rebuild(next);
    if (persist && this.store) {
      await this.store.save({
        schemaVersion: 1, executionSpecId: "V1-EXEC-10", chainId: this.chainId, startBlock: this.startBlock,
        anchorParentHash: this.anchorParentHash, blocks: next,
      });
    }
    this.#blocks = next;
    this.#state = nextState;
    return "applied";
  }
}
