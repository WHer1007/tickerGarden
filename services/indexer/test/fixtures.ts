import type { CanonicalBlock, DecodedV1Event } from "../src/index.ts";
import type { V1EventArgsBySignature, V1EventSignature } from "../src/generated/v1-events.ts";

export const id = (value: string): `0x${string}` => `0x${value.padStart(64, "0")}`;
export const address = (value: string): `0x${string}` => `0x${value.padStart(40, "0")}`;

export function event<Signature extends V1EventSignature>(
  signature: Signature,
  args: V1EventArgsBySignature[Signature],
  blockNumber: bigint,
  blockHash: string,
  logIndex = 0,
  overrides: Partial<DecodedV1Event> = {},
): DecodedV1Event {
  return {
    chainId: 4663, blockNumber, blockHash, transactionHash: id(`a${blockNumber}`),
    transactionIndex: 0, logIndex, emitter: address("1"), signature, args, ...overrides,
  } as DecodedV1Event;
}

export function block(number: bigint, hash: string, parentHash: string, events: readonly DecodedV1Event[]): CanonicalBlock {
  return { chainId: 4663, number, hash, parentHash, events };
}
