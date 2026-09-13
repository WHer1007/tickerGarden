import { decodeEventLog, parseAbi, getAbiItem, keccak256, toBytes, type Abi, type Log } from 'viem';
import type { ContractSource, RpcLog, RpcTransport } from '../../chain/src/index.ts';
import { f72EventAbis, f72ReadAbis, currentEventAbis } from './f72-abis.generated.ts';
export { f72ReadAbis } from './f72-abis.generated.ts';

export const CURRENT_RELEASE_ID = '0x685b5c20e826f4ddd076b61216c7529a967322082925c4741469b0fda837a7f2' as const;
export const CURRENT_ACTIVATION_BLOCK = 118689839n;
// Compatibility aliases for the frozen projector modules. Runtime identity is the current release above.
export const F72_RELEASE_ID = CURRENT_RELEASE_ID;
export const F72_ACTIVATION_BLOCK = CURRENT_ACTIVATION_BLOCK;
export const F72_LEGACY_ABI_FINGERPRINT = 'sha256:d80208c1ac00e7e2ab31fa7ce94bee6ed4159a802519b9d0fdbdf5a300a81b41' as const;

export interface EventCatalogEntry {
  readonly module: string;
  readonly address?: `0x${string}`;
  readonly runtimeCodeHash?: `0x${string}`;
  readonly abi: Abi;
}

const event = (name: string, inputs: readonly { readonly name: string; readonly type: string; readonly indexed?: boolean }[]) => ({
  type: 'event' as const,
  name,
  anonymous: false,
  inputs: inputs.map((input) => ({ ...input, indexed: input.indexed ?? false })),
});

export const f72EventCatalog = {
  UniswapV4PoolManager: {
    module: 'UniswapV4PoolManager', address: '0x8366a39cc670b4001a1121b8f6a443a643e40951', runtimeCodeHash: '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626',
    abi: [event('Swap', [
      { name: 'id', type: 'bytes32', indexed: true }, { name: 'sender', type: 'address', indexed: true },
      { name: 'amount0', type: 'int128' }, { name: 'amount1', type: 'int128' }, { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'liquidity', type: 'uint128' }, { name: 'tick', type: 'int24' }, { name: 'fee', type: 'uint24' },
    ])],
  },
  TickerGardenFactoryV1: {
    module: 'TickerGardenFactoryV1', address: '0xf11839c3566c8b3345ed81e4a0e26cc38aa2866a', runtimeCodeHash: '0x1e6a01d66b1c6cce16242e8d5a908c2c5300e6392af0f16e2c7618630f7fb19f',
    abi: [event('MarketCreated', [
      { name: 'marketId', type: 'bytes32', indexed: true }, { name: 'assetUid', type: 'bytes32', indexed: true },
      { name: 'memeToken', type: 'address', indexed: true }, { name: 'curve', type: 'address' }, { name: 'gauge', type: 'address' },
      { name: 'quoteAsset', type: 'address' }, { name: 'tickerGardenBaselineId', type: 'bytes32' },
      { name: 'quoteAssetConfigId', type: 'bytes32' }, { name: 'expectedEconomics', type: 'bytes32' },
    ])],
  },
  MarketRegistryV1: {
    module: 'MarketRegistryV1', address: '0xab37f78d3a41c8f510f5a95a74f1ff1144e14660', runtimeCodeHash: '0xfc62631faca6e2a25ff2076c63b2eed8165d79a4fc05cc0b3813c78e6f3a6ee1',
    abi: [
      event('MarketRegistered', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'assetUid', type: 'bytes32', indexed: true }, { name: 'memeToken', type: 'address', indexed: true }, { name: 'curve', type: 'address' }, { name: 'gauge', type: 'address' }, { name: 'sourceVersion', type: 'uint32' }]),
      event('LaunchPhaseChanged', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'oldPhase', type: 'uint8' }, { name: 'newPhase', type: 'uint8' }, { name: 'poolId', type: 'bytes32' }, { name: 'sourceVersion', type: 'uint32' }]),
    ],
  },
  TickerGardenCurve: {
    module: 'TickerGardenCurve',
    abi: [
      event('CurveBuy', [{ name: 'buyer', type: 'address', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'quoteIn', type: 'uint256' }, { name: 'tokensOut', type: 'uint256' }, { name: 'fee', type: 'uint256' }, { name: 'tax', type: 'uint256' }]),
      event('CurveSell', [{ name: 'seller', type: 'address', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'tokensIn', type: 'uint256' }, { name: 'quoteOut', type: 'uint256' }, { name: 'fee', type: 'uint256' }, { name: 'tax', type: 'uint256' }]),
      event('CurveBuyRefunded', [{ name: 'buyer', type: 'address', indexed: true }, { name: 'unusedQuote', type: 'uint256' }]),
      event('CurveCompleted', [{ name: 'marketId', type: 'bytes32', indexed: true }]),
      event('CurveFeeTransferred', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'sweepNonce', type: 'uint64', indexed: true }, { name: 'feeId', type: 'bytes32', indexed: true }, { name: 'amount', type: 'uint256' }]),
    ],
  },
  TickerMemeTokenV1: {
    module: 'TickerMemeTokenV1',
    abi: [event('Transfer', [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256' }])],
  },
  MemeStockGauge: {
    module: 'MemeStockGauge',
    abi: [
      event('PendingScheduled', [{ name: 'user', type: 'address', indexed: true }, { name: 'marketId', type: 'bytes32', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'generation', type: 'uint64' }, { name: 'unlockAt', type: 'uint64' }]),
      event('PendingRescheduled', [{ name: 'user', type: 'address', indexed: true }, { name: 'marketId', type: 'bytes32', indexed: true }, { name: 'oldGeneration', type: 'uint64' }, { name: 'newGeneration', type: 'uint64' }, { name: 'combinedAmount', type: 'uint256' }, { name: 'unlockAt', type: 'uint64' }]),
      event('PendingMaterialized', [{ name: 'user', type: 'address', indexed: true }, { name: 'marketId', type: 'bytes32', indexed: true }, { name: 'generation', type: 'uint64', indexed: true }, { name: 'amount', type: 'uint256' }]),
      event('StakerFeeCredited', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'feeAsset', type: 'address', indexed: true }, { name: 'feeId', type: 'bytes32', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'accumulatorDelta', type: 'uint256' }, { name: 'indexRemainder', type: 'uint256' }]),
      event('GaugeRageQuit', [{ name: 'user', type: 'address', indexed: true }, { name: 'marketId', type: 'bytes32', indexed: true }, { name: 'principal', type: 'uint256' }, { name: 'quoteForfeited', type: 'uint256' }, { name: 'memeForfeited', type: 'uint256' }]),
    ],
  },
  TickerGardenMemeHook: {
    module: 'TickerGardenMemeHook', address: '0x3d10b2891730dc11f352087b0703a93772d56044', runtimeCodeHash: '0x164368eb2fb934a34e1504cfdf91b419590f9b1aba9a2ce337f54a8db2e42ed4',
    abi: [
      event('ExpectedPoolRegistered', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'poolId', type: 'bytes32', indexed: true }, { name: 'keyHash', type: 'bytes32' }, { name: 'sourceVersion', type: 'uint32' }]),
      event('PoolBindingActivated', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'poolId', type: 'bytes32', indexed: true }, { name: 'sourceVersion', type: 'uint32' }]),
      event('V4FeeAccrued', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'poolId', type: 'bytes32', indexed: true }, { name: 'feeAsset', type: 'address', indexed: true }, { name: 'feeNonce', type: 'uint64' }, { name: 'feeId', type: 'bytes32' }, { name: 'base', type: 'uint256' }, { name: 'totalFee', type: 'uint256' }, { name: 'lpAmount', type: 'uint256' }, { name: 'nonLpAmount', type: 'uint256' }]),
    ],
  },
  ProtocolFeeVault: {
    module: 'ProtocolFeeVault', address: '0x8c4ce2bb409b68697024afc28d26138d621035e2', runtimeCodeHash: '0x5f6abae71d47548c743da95d60e043110559162758d8013e959d553ed883f863',
    abi: [
      event('MemeFeesBurned', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'beneficiary', type: 'address', indexed: true }, { name: 'role', type: 'uint8', indexed: true }, { name: 'creatorEpoch', type: 'uint32' }, { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }]),
      event('CurveFeesSwept', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'creatorEpoch', type: 'uint32', indexed: true }, { name: 'quoteAsset', type: 'address', indexed: true }, { name: 'sweepNonce', type: 'uint64' }, { name: 'feeId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }, { name: 'creatorAmount', type: 'uint256' }, { name: 'platformAmount', type: 'uint256' }]),
      event('FeeBucketsCredited', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'creatorEpoch', type: 'uint32', indexed: true }, { name: 'feeAsset', type: 'address', indexed: true }, { name: 'feeId', type: 'bytes32' }, { name: 'creatorAmount', type: 'uint256' }, { name: 'stakerAmount', type: 'uint256' }, { name: 'platformAmount', type: 'uint256' }, { name: 'activeStock', type: 'uint256' }]),
      event('FeeClaimed', [{ name: 'beneficiaryType', type: 'uint8', indexed: true }, { name: 'beneficiary', type: 'address', indexed: true }, { name: 'marketId', type: 'bytes32', indexed: true }, { name: 'beneficiaryEpoch', type: 'uint32' }, { name: 'feeAsset', type: 'address' }, { name: 'amount', type: 'uint256' }]),
      event('RewardConverted', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'user', type: 'address', indexed: true }, { name: 'creatorEpoch', type: 'uint32', indexed: true }, { name: 'memeSpent', type: 'uint256' }, { name: 'quoteReceived', type: 'uint256' }]),
    ],
  },
  HolderRewardsDistributorV1: {
    module: 'HolderRewardsDistributorV1', address: '0xc2716b960bd675fa7f605ce8d191b6e247cf61e8', runtimeCodeHash: '0xbb7526295c01043903896f54d7dc294c5d76b41266508160c5a327a5574f2cdb',
    abi: [
      event('HolderStreamMarketRegistered', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'token', type: 'address', indexed: true }, { name: 'quote', type: 'address' }, { name: 'vault', type: 'address' }]),
      event('HolderAssetFunded', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'asset', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }]),
      event('HolderRewardsQueued', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'amount', type: 'uint256' }]),
      event('HolderStreamFunded', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'end', type: 'uint64' }]),
      event('HolderStreamClaimed', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'account', type: 'address', indexed: true }, { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }]),
    ],
  },
} as const satisfies Record<string, EventCatalogEntry>;

export type DecodedProtocolEvent = {
  readonly module: keyof typeof f72EventAbis;
  readonly eventName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly log: RpcLog;
};

export function protocolEventAbi(module: keyof typeof f72EventAbis): Abi {
  const current = currentEventAbis[module as keyof typeof currentEventAbis] as Abi | undefined;
  if (current) {
    const entries = [...f72EventAbis[module], ...current];
    return [...new Map(entries.filter(item => item.type === 'event').map(item => [
      `${item.name}(${item.inputs.map(input => input.type).join(',')})`, item,
    ])).values()];
  }
  const legacy=f72EventAbis[module] as Abi;
  if(module==='HolderRewardsDistributorV1')return [...legacy,...parseAbi([
    'event SnapshotPublisherChanged(address indexed previousPublisher,address indexed newPublisher)',
    'event HolderSnapshotMarketRegistered(bytes32 indexed marketId,address indexed token,address quote,address vault)',
    'event HolderSnapshotPublished(bytes32 indexed marketId,uint64 indexed round,uint64 snapshotBlock,bytes32 snapshotBlockHash,bytes32 root,bytes32 dataHash,uint256 quoteBudget,uint256 memeBudget)',
    'event HolderSnapshotClaimed(bytes32 indexed marketId,uint64 indexed round,address indexed account,uint8 assets,uint256 quotePaid,uint256 memePaid)',
  ])];
  return module==='ProtocolFeeVault' ? [...legacy,...f72EventCatalog.ProtocolFeeVault.abi.filter(e=>e.name==='MemeFeesBurned'),...parseAbi(['event UserRewardsClaimed(bytes32 indexed marketId,address indexed user,uint8 indexed role,uint32 creatorEpoch,uint256 quotePaid,uint256 memePaid)'])] : legacy;
}

export function decodeF72Event(module: keyof typeof f72EventAbis, log: RpcLog): DecodedProtocolEvent | null {
  try {
    const decoded = decodeEventLog({ abi: protocolEventAbi(module), data: log.data, topics: log.topics as Log['topics'], strict: true });
    if (typeof decoded.eventName !== 'string' || !decoded.args || Array.isArray(decoded.args)) return null;
    return { module, eventName: decoded.eventName, args: decoded.args as unknown as Readonly<Record<string, unknown>>, log };
  } catch {
    return null;
  }
}

export function eventTopic(module: keyof typeof f72EventAbis, eventName: string): `0x${string}` {
  const item = getAbiItem({ abi: protocolEventAbi(module), name: eventName });
  if (!item || item.type !== 'event') throw new Error('catalog item is not an event');
  const types = item.inputs.map((input) => input.type).join(',');
  return keccak256(toBytes(`${item.name}(${types})`));
}

export function eventTopicsForModules(modules: readonly string[]): `0x${string}`[] {
  const topics = new Set<`0x${string}`>();
  for (const module of modules) {
    const abi = module in f72EventAbis ? protocolEventAbi(module as keyof typeof f72EventAbis) : undefined;
    if (!abi) continue;
    for (const item of abi) {
      if (item.type !== 'event') continue;
      const types = item.inputs.map((input) => input.type).join(',');
      topics.add(keccak256(toBytes(`${item.name}(${types})`)));
    }
  }
  return [...topics].sort();
}

const F72_FIXED_IDENTITIES = [
  ['UniswapV4PoolManager', '0x8366a39cc670b4001a1121b8f6a443a643e40951', '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626'],
  ['OfficialStockRegistryV1', '0x01564750928a97faddc94c69306e6a8598cd2a03', '0xd337f661c880e81ebc21428bff151065ccc9a351a280dbc63b1befa7115342d5'],
  ['ApprovedQuoteRegistry', '0x14697017390ee72157b0f294764673e36a6a614d', '0xdb701f708bcb23f781c919c65616e915219ac3b1512010f3417c660c337926d5'],
  ['TickerGardenBaselineRegistry', '0xdab7eba06f8fbecad13ae622d6993c6f645d099a', '0x1208c97e82b8143e8cc07b28c83f4597f5fa85085f12f2cb3627c20a58482503'],
  ['LaunchTemplateRegistry', '0x3bd049845131ba86fcbf17685acedb203afe7e8c', '0xa8a0bbe1f2c605016b904c9ddae35077ff81fe7176750605419691ef8b9f3b31'],
  ['LaunchConfigResolver', '0x04a1ab04a0cc3f27afa7a1c24bb23fb540a81c40', '0x4995a01fe5525baff9266dc75294fa6bae67d64674de247364199075f43fa59f'],
  ['MemeStockGauge', '0x97f033be7243123a4bf86026560809b8cd03eee3', '0x3e3f1fcd99cab3ed17310a7197535514f590eff63ce17fb8e158e732351bce52'],
  ['LaunchAndBuyRouter', '0xdce9a656eb611a7ee34651ead17f3b76e2155756', '0xd0ab3206826a1c15ccc4290b1729402d085f2395a0c39feb542388e30c7d6804'],
  ['MarketRegistryV1', '0xab37f78d3a41c8f510f5a95a74f1ff1144e14660', '0xfc62631faca6e2a25ff2076c63b2eed8165d79a4fc05cc0b3813c78e6f3a6ee1'],
  ['CreatorRevenueRegistry', '0x02d2700ce866c2e88bb21819df07f8b894ec7d73', '0xef5abaf94e1684f56c3fed0c228dc78cc50cb26b9256ccf9bf11999002e0ccaf'],
  ['AllocationManager', '0x6eac1c710edf540bbacfc3b5da2ad427e916741f', '0x3a7627b643d0bf185311d8d45a911d6e48216d69c037e8b4c85a7ca5f56ba47b'],
  ['UserStockVault', '0x6910d8eeecd8589bed39830ea854ae250584e59e', '0x6b8ed73c261035ba23eec89c0b8f5ac79e130c983cb45327a91d7c85277fbab4'],
  ['HolderRewardsDistributorV1', '0xc2716b960bd675fa7f605ce8d191b6e247cf61e8', '0xbb7526295c01043903896f54d7dc294c5d76b41266508160c5a327a5574f2cdb'],
  ['ProtocolFeeVault', '0x8c4ce2bb409b68697024afc28d26138d621035e2', '0x5f6abae71d47548c743da95d60e043110559162758d8013e959d553ed883f863'],
  ['TickerGardenMemeHook', '0x3d10b2891730dc11f352087b0703a93772d56044', '0x164368eb2fb934a34e1504cfdf91b419590f9b1aba9a2ce337f54a8db2e42ed4'],
  ['GraduationExecutor', '0xbc20f5659fb44fb1471901ca8fdba9f068a464e9', '0x2bfb6e9f5e81bc5b58708f5b21b863e79139f6e46f57bdc65e81577e52cfa492'],
  ['TickerGardenFactoryV1', '0xf11839c3566c8b3345ed81e4a0e26cc38aa2866a', '0x1e6a01d66b1c6cce16242e8d5a908c2c5300e6392af0f16e2c7618630f7fb19f'],
] as const;

export function fixedF72Sources(): ContractSource[] {
  return F72_FIXED_IDENTITIES.map(([module, address, runtimeCodeHash]) => ({ module, address, birthBlock: F72_ACTIVATION_BLOCK, runtimeCodeHash }));
}

export async function discoverF72MarketSources(logs: readonly RpcLog[], blockNumber: bigint, primary: RpcTransport, secondary?: RpcTransport): Promise<ContractSource[]> {
  const discovered = new Map<string, ContractSource>();
  for (const log of logs) {
    if (log.address !== f72EventCatalog.TickerGardenFactoryV1.address) continue;
    const decoded = decodeF72Event('TickerGardenFactoryV1', log);
    if (!decoded || decoded.eventName !== 'MarketCreated') continue;
    for (const [module, rawAddress] of [['TickerMemeTokenV1', decoded.args.memeToken], ['TickerGardenCurve', decoded.args.curve], ['MemeStockGauge', decoded.args.gauge]] as const) {
      if (typeof rawAddress !== 'string' || rawAddress === '0x0000000000000000000000000000000000000000') continue;
      const address = rawAddress.toLowerCase() as `0x${string}`;
      const primaryHash = await primary.codeHash(address, blockNumber);
      if (secondary) {
        const secondaryHash = await secondary.codeHash(address, blockNumber);
        if (secondaryHash !== primaryHash) throw new Error('RPC providers disagree on discovered runtime code hash');
      }
      discovered.set(address, { module, address, birthBlock: blockNumber, runtimeCodeHash: primaryHash });
    }
  }
  return [...discovered.values()];
}

export function protocolEventSignature(event: DecodedProtocolEvent): string {
  const entries = protocolEventAbi(event.module) as readonly { readonly type: string; readonly name?: string; readonly inputs?: readonly { readonly type: string }[] }[];
  const item = entries.find((entry) => entry.type === 'event' && entry.name === event.eventName && keccak256(toBytes(`${entry.name}(${entry.inputs?.map(input=>input.type).join(',')})`))===event.log.topics[0]);
  if (!item?.inputs) throw new Error('event signature is absent from supported ABI');
  return `${event.eventName}(${item.inputs.map((input) => input.type).join(',')})`;
}
