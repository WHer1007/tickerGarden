const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;

export interface EventFilter {
  readonly schema: 'tickergarden.chain-event-filter.v1';
  readonly chainId: 4663 | 46630;
  readonly environment: 'test' | 'production';
  readonly releaseId: `0x${string}`;
  readonly activationBlock: bigint;
  readonly sharedPoolManager: { readonly address: `0x${string}`; readonly swapTopic: `0x${string}` };
  readonly fixedAddresses: readonly `0x${string}`[];
  readonly eventTopics: readonly `0x${string}`[];
}

export interface SourceAddress {
  readonly address: `0x${string}`;
  readonly birthBlock: bigint;
}

export interface PoolBinding {
  readonly poolId: `0x${string}`;
  readonly birthBlock: bigint;
}

export interface SubscriptionLog {
  readonly address: `0x${string}`;
  readonly blockHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly transactionHash: `0x${string}`;
  readonly transactionIndex: bigint;
  readonly logIndex: bigint;
  readonly data: `0x${string}`;
  readonly topics: readonly `0x${string}`[];
  readonly removed: boolean;
}

export function parseEventFilter(value: unknown): EventFilter {
  const item = record(value);
  const shared = record(item.sharedPoolManager);
  if (item.schema !== 'tickergarden.chain-event-filter.v1' || !((item.chainId === 46630 && item.environment === 'test') || (item.chainId === 4663 && item.environment === 'production'))
    || typeof item.releaseId !== 'string' || !HASH.test(item.releaseId)
    || typeof item.activationBlock !== 'string' || !/^[0-9]+$/.test(item.activationBlock)
    || typeof shared.address !== 'string' || !ADDRESS.test(shared.address)
    || typeof shared.swapTopic !== 'string' || !HASH.test(shared.swapTopic)) throw new Error('invalid chain event filter identity');
  const fixedAddresses = stringArray(item.fixedAddresses, ADDRESS, 1_000, 'fixed addresses');
  const eventTopics = stringArray(item.eventTopics, HASH, 1_000, 'event topics');
  if (new Set(fixedAddresses).size !== fixedAddresses.length || new Set(eventTopics).size !== eventTopics.length) throw new Error('duplicate chain event filter item');
  if (!fixedAddresses.includes(shared.address) || !eventTopics.includes(shared.swapTopic)) throw new Error('shared pool filter is outside the allowlist');
  return Object.freeze({
    schema: item.schema, chainId: item.chainId, environment: item.environment,
    releaseId: item.releaseId as `0x${string}`, activationBlock: BigInt(item.activationBlock),
    sharedPoolManager: Object.freeze({ address: shared.address as `0x${string}`, swapTopic: shared.swapTopic as `0x${string}` }),
    fixedAddresses: Object.freeze(fixedAddresses as `0x${string}`[]), eventTopics: Object.freeze(eventTopics as `0x${string}`[]),
  });
}

export function parseSubscriptionLog(value: unknown): SubscriptionLog {
  const item = record(value);
  if (typeof item.address !== 'string' || !ADDRESS.test(item.address)
    || typeof item.blockHash !== 'string' || !HASH.test(item.blockHash)
    || typeof item.blockNumber !== 'string' || !QUANTITY.test(item.blockNumber)
    || typeof item.transactionHash !== 'string' || !HASH.test(item.transactionHash)
    || typeof item.transactionIndex !== 'string' || !QUANTITY.test(item.transactionIndex)
    || typeof item.logIndex !== 'string' || !QUANTITY.test(item.logIndex)
    || typeof item.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(item.data)
    || typeof item.removed !== 'boolean') throw new Error('invalid subscription log');
  const topics = stringArray(item.topics, HASH, 4, 'log topics');
  if (topics.length === 0) throw new Error('subscription log has no topic0');
  return Object.freeze({
    address: item.address.toLowerCase() as `0x${string}`, blockHash: item.blockHash.toLowerCase() as `0x${string}`,
    blockNumber: BigInt(item.blockNumber), transactionHash: item.transactionHash.toLowerCase() as `0x${string}`,
    transactionIndex: BigInt(item.transactionIndex), logIndex: BigInt(item.logIndex), data: item.data.toLowerCase() as `0x${string}`,
    topics: Object.freeze(topics.map((topic) => topic.toLowerCase() as `0x${string}`)), removed: item.removed,
  });
}

export function eventKey(log: SubscriptionLog): string {
  return `${log.blockHash}:${log.transactionHash}:${log.logIndex}:${log.removed ? 'removed' : 'canonical'}`;
}

export function subscriptionParameters(addresses: readonly string[], topics: readonly string[]): readonly unknown[] {
  if (addresses.length === 0 || topics.length === 0) throw new Error('subscription filter cannot be empty');
  return ['logs', { address: [...addresses].sort(), topics: [[...topics].sort()] }] as const;
}

export function subscriptionFilters(filter: EventFilter, sources: readonly SourceAddress[], pools: readonly PoolBinding[]): readonly Record<string, unknown>[] {
  const ordinaryAddresses = sources.map((item) => item.address).filter((address) => address !== filter.sharedPoolManager.address);
  const ordinaryTopics = filter.eventTopics.filter((topic) => topic !== filter.sharedPoolManager.swapTopic);
  const result: Record<string, unknown>[] = [];
  if (ordinaryAddresses.length > 0 && ordinaryTopics.length > 0) {
    const sorted = [...new Set(ordinaryAddresses)].sort();
    for (let offset = 0; offset < sorted.length; offset += 500) result.push({ address: sorted.slice(offset, offset + 500), topics: [[...ordinaryTopics].sort()] });
  }
  const poolIds = [...new Set(pools.map((pool) => pool.poolId))].sort();
  if (poolIds.length > 0) {
    for (let offset = 0; offset < poolIds.length; offset += 500) result.push({ address: filter.sharedPoolManager.address, topics: [[filter.sharedPoolManager.swapTopic], poolIds.slice(offset, offset + 500)] });
  }
  return result;
}

export function matchesFilter(filter: EventFilter, log: SubscriptionLog, addresses: ReadonlySet<string>, poolIds: ReadonlySet<string>): boolean {
  if (!addresses.has(log.address)) return false;
  if (log.address === filter.sharedPoolManager.address) {
    return log.topics[0] === filter.sharedPoolManager.swapTopic && typeof log.topics[1] === 'string' && poolIds.has(log.topics[1]);
  }
  return log.topics[0] !== filter.sharedPoolManager.swapTopic && filter.eventTopics.includes(log.topics[0]!);
}

export function serializeTrigger(filter: EventFilter, log: SubscriptionLog, head: { readonly number: bigint; readonly hash: `0x${string}` }): string {
  return JSON.stringify({
    schema: 'tickergarden.chain-log-trigger.v1', environment: filter.environment, chainId: filter.chainId, releaseId: filter.releaseId,
    head: { number: head.number.toString(), hash: head.hash },
    log: {
      address: log.address, blockHash: log.blockHash, blockNumber: log.blockNumber.toString(), transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex.toString(), logIndex: log.logIndex.toString(), data: log.data, topics: log.topics, removed: log.removed,
    },
  });
}

export function mergeSources(filter: EventFilter, dynamic: readonly SourceAddress[]): readonly SourceAddress[] {
  const byAddress = new Map<string, SourceAddress>();
  for (const address of filter.fixedAddresses) byAddress.set(address, { address, birthBlock: filter.activationBlock });
  for (const source of dynamic) {
    if (!ADDRESS.test(source.address) || source.birthBlock < 0n) throw new Error('invalid dynamic source');
    const current = byAddress.get(source.address);
    if (!current || source.birthBlock < current.birthBlock) byAddress.set(source.address, source);
  }
  return [...byAddress.values()].sort((left, right) => left.address.localeCompare(right.address));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object');
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, pattern: RegExp, maximum: number, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum
    || value.some((item) => typeof item !== 'string' || !pattern.test(item))) throw new Error(`invalid ${label}`);
  return value as string[];
}
