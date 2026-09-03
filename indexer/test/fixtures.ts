import type { CanonicalBlock, DecodedV2Event } from "../src/index.ts";
import type { V2EventArgsBySignature, V2EventSignature } from "../src/generated/v2-events.ts";

export const id = (value: string): `0x${string}` => `0x${value.padStart(64, "0")}`;
export const address = (value: string): `0x${string}` => `0x${value.padStart(40, "0")}`;

export function event<Signature extends V2EventSignature>(
  signature: Signature,
  args: V2EventArgsBySignature[Signature],
  blockNumber: bigint,
  blockHash: string,
  logIndex = 0,
  overrides: Partial<DecodedV2Event> = {},
): DecodedV2Event {
  return {
    chainId: 4663, blockNumber, blockHash, transactionHash: id(`a${blockNumber}`),
    transactionIndex: 0, logIndex, emitter: address("1"), signature, args, ...overrides,
  } as DecodedV2Event;
}

export function block(number: bigint, hash: string, parentHash: string, events: readonly DecodedV2Event[]): CanonicalBlock {
  return { chainId: 4663, number, hash, parentHash, events };
}
