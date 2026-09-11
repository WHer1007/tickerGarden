import { readFile } from 'node:fs/promises';
import { consensusBlock, RpcTransport, verifyChainIdentity, type RpcLog } from '../packages/chain/src/index.ts';
import {
  decodeF72Event, discoverF72MarketSources, eventTopic, F72_RELEASE_ID, f72EventCatalog, fixedF72Sources,
} from '../packages/events/src/index.ts';

const baseline = JSON.parse(await readFile(new URL('../../../docs/backend/typescript-serverless-baseline.json', import.meta.url), 'utf8')) as {
  target: {
    chainId: number; genesisHash: string; releaseId: string;
    activationBlockNumber: string; activationBlockHash: string;
    qaMarketRange: { count: number; firstCreatedBlock?: string; lastCreatedBlock?: string };
  };
};
if (baseline.target.releaseId !== F72_RELEASE_ID) throw new Error('event catalog release does not match baseline release');

const primaryUrl = process.env.TG_RPC_URL
  ?? (process.env.ALCHEMY_API_KEY ? `https://robinhood-testnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : undefined);
const secondaryUrl = process.env.TG_SECONDARY_RPC_URL ?? process.env.RH46630_RPC_PUBLIC;
if (!primaryUrl || !secondaryUrl) throw new Error('primary and secondary RPC URLs are required');
const primary = new RpcTransport({ url: primaryUrl });
const secondary = new RpcTransport({ url: secondaryUrl });
await Promise.all([
  verifyChainIdentity(primary, BigInt(baseline.target.chainId), baseline.target.genesisHash),
  verifyChainIdentity(secondary, BigInt(baseline.target.chainId), baseline.target.genesisHash),
]);
const activation = await consensusBlock(primary, secondary, BigInt(baseline.target.activationBlockNumber));
if (activation.hash !== baseline.target.activationBlockHash) throw new Error('activation block hash mismatch');

for (const source of fixedF72Sources()) {
  const [first, second] = await Promise.all([primary.codeHash(source.address, source.birthBlock), secondary.codeHash(source.address, source.birthBlock)]);
  if (first !== source.runtimeCodeHash || second !== source.runtimeCodeHash) throw new Error(`fixed runtime code hash mismatch for ${source.module}`);
}

const marketCreatedTopic = eventTopic('TickerGardenFactoryV1', 'MarketCreated');
const marketLogs: RpcLog[] = [];
const range = baseline.target.qaMarketRange;
if (range.count > 0) {
  if (!range.firstCreatedBlock || !range.lastCreatedBlock) throw new Error('positive QA market count requires a frozen block range');
  const from = BigInt(range.firstCreatedBlock);
  const to = BigInt(range.lastCreatedBlock);
  if (from < BigInt(baseline.target.activationBlockNumber) || to < from) throw new Error('QA market range is outside the current deployment');
  for (let cursor = from; cursor <= to; cursor += 10n) {
    const end = cursor + 9n < to ? cursor + 9n : to;
    const input = { fromBlock: cursor, toBlock: end, addresses: [f72EventCatalog.TickerGardenFactoryV1.address], topics: [marketCreatedTopic] } as const;
    const [first, second] = await Promise.all([primary.logs(input), secondary.logs(input)]);
    const canonical = (logs: readonly RpcLog[]) => JSON.stringify(logs, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    if (canonical(first) !== canonical(second)) throw new Error(`providers disagree on MarketCreated logs in ${cursor}-${end}`);
    marketLogs.push(...first);
  }
}
if (marketLogs.length !== range.count) throw new Error('QA MarketCreated count does not match frozen baseline');

let dynamicSourceCount = 0;
for (const log of marketLogs) {
  const decoded = decodeF72Event('TickerGardenFactoryV1', log);
  if (!decoded || decoded.eventName !== 'MarketCreated') throw new Error('deployed MarketCreated log does not match frozen ABI');
  dynamicSourceCount += (await discoverF72MarketSources([log], log.blockNumber, primary, secondary)).length;
}

console.log(JSON.stringify({
  status: 'verified', releaseId: F72_RELEASE_ID, fixedSources: fixedF72Sources().length,
  activationBlock: baseline.target.activationBlockNumber, activationHash: activation.hash,
  marketCreatedLogs: marketLogs.length, dynamicSources: dynamicSourceCount, providers: 2,
  scope: range.count === 0 ? 'deployment-and-bootstrap-only' : 'deployment-bootstrap-and-frozen-market-range',
}));
