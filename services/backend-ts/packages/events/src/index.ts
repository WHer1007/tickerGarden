import { decodeEventLog, getAbiItem, keccak256, toBytes, type Abi, type Log } from 'viem';
import type { ContractSource, RpcLog, RpcTransport } from '../../chain/src/index.ts';
import { f72EventAbis, f72ReadAbis } from './f72-abis.generated.ts';
export { f72ReadAbis } from './f72-abis.generated.ts';

export const CURRENT_RELEASE_ID = '0x5c2c656b1b23e895ea268c34b187cd267e0f4fdcc1759c726cbca7fafb7c9c12' as const;
export const CURRENT_ACTIVATION_BLOCK = 117032526n;
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
    module: 'TickerGardenFactoryV1', address: '0x496a3cb9fd8a045c590f311e948b2b4382f17904', runtimeCodeHash: '0xeb1bfed084ffe0480e218009629f48676dc591de3d666bf1227ba80ea2404a9b',
    abi: [event('MarketCreated', [
      { name: 'marketId', type: 'bytes32', indexed: true }, { name: 'assetUid', type: 'bytes32', indexed: true },
      { name: 'memeToken', type: 'address', indexed: true }, { name: 'curve', type: 'address' }, { name: 'gauge', type: 'address' },
      { name: 'quoteAsset', type: 'address' }, { name: 'tickerGardenBaselineId', type: 'bytes32' },
      { name: 'quoteAssetConfigId', type: 'bytes32' }, { name: 'expectedEconomics', type: 'bytes32' },
    ])],
  },
  MarketRegistryV1: {
    module: 'MarketRegistryV1', address: '0x03f8a6e75ce7bf707076d7339968f8fdf5703b16', runtimeCodeHash: '0x2944d48b578c583511c37f71f6ddc811201b3dfb25b4fa920173c70f443d43fb',
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
    module: 'TickerGardenMemeHook', address: '0xf5e89af0949745fe497b22d1214fea3daa75a044', runtimeCodeHash: '0x3046cd98e4e8850911bfb3b1781548dbd866ac67224315cae08c5a30e48b5b06',
    abi: [
      event('ExpectedPoolRegistered', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'poolId', type: 'bytes32', indexed: true }, { name: 'keyHash', type: 'bytes32' }, { name: 'sourceVersion', type: 'uint32' }]),
      event('PoolBindingActivated', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'poolId', type: 'bytes32', indexed: true }, { name: 'sourceVersion', type: 'uint32' }]),
      event('V4FeeAccrued', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'poolId', type: 'bytes32', indexed: true }, { name: 'feeAsset', type: 'address', indexed: true }, { name: 'feeNonce', type: 'uint64' }, { name: 'feeId', type: 'bytes32' }, { name: 'base', type: 'uint256' }, { name: 'totalFee', type: 'uint256' }, { name: 'lpAmount', type: 'uint256' }, { name: 'nonLpAmount', type: 'uint256' }]),
    ],
  },
  ProtocolFeeVault: {
    module: 'ProtocolFeeVault', address: '0x9cba4929745077198393f09ad2f409db43c90da9', runtimeCodeHash: '0x901c78e4746305d5aae770f8b600ef083b151fa855faa5dc7e7c68708846afc6',
    abi: [
      event('CurveFeesSwept', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'creatorEpoch', type: 'uint32', indexed: true }, { name: 'quoteAsset', type: 'address', indexed: true }, { name: 'sweepNonce', type: 'uint64' }, { name: 'feeId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }, { name: 'creatorAmount', type: 'uint256' }, { name: 'platformAmount', type: 'uint256' }]),
      event('FeeBucketsCredited', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'creatorEpoch', type: 'uint32', indexed: true }, { name: 'feeAsset', type: 'address', indexed: true }, { name: 'feeId', type: 'bytes32' }, { name: 'creatorAmount', type: 'uint256' }, { name: 'stakerAmount', type: 'uint256' }, { name: 'platformAmount', type: 'uint256' }, { name: 'activeStock', type: 'uint256' }]),
      event('FeeClaimed', [{ name: 'beneficiaryType', type: 'uint8', indexed: true }, { name: 'beneficiary', type: 'address', indexed: true }, { name: 'marketId', type: 'bytes32', indexed: true }, { name: 'beneficiaryEpoch', type: 'uint32' }, { name: 'feeAsset', type: 'address' }, { name: 'amount', type: 'uint256' }]),
      event('RewardConverted', [{ name: 'marketId', type: 'bytes32', indexed: true }, { name: 'user', type: 'address', indexed: true }, { name: 'creatorEpoch', type: 'uint32', indexed: true }, { name: 'memeSpent', type: 'uint256' }, { name: 'quoteReceived', type: 'uint256' }]),
    ],
  },
  HolderRewardsDistributorV1: {
    module: 'HolderRewardsDistributorV1', address: '0x88dfa615583abfbffed04a40e902d41cc550c992', runtimeCodeHash: '0x5fdcb2fad4292f8f0920b8b8d9eb31418fbe3fc74b2baec8256ebe3434fe6ce5',
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

export function decodeF72Event(module: keyof typeof f72EventAbis, log: RpcLog): DecodedProtocolEvent | null {
  try {
    const decoded = decodeEventLog({ abi: f72EventAbis[module] as Abi, data: log.data, topics: log.topics as Log['topics'], strict: true });
    if (typeof decoded.eventName !== 'string' || !decoded.args || Array.isArray(decoded.args)) return null;
    return { module, eventName: decoded.eventName, args: decoded.args as unknown as Readonly<Record<string, unknown>>, log };
  } catch {
    return null;
  }
}

export function eventTopic(module: keyof typeof f72EventAbis, eventName: string): `0x${string}` {
  const item = getAbiItem({ abi: f72EventAbis[module] as Abi, name: eventName });
  if (!item || item.type !== 'event') throw new Error('catalog item is not an event');
  const types = item.inputs.map((input) => input.type).join(',');
  return keccak256(toBytes(`${item.name}(${types})`));
}

const F72_FIXED_IDENTITIES = [
  ['UniswapV4PoolManager', '0x8366a39cc670b4001a1121b8f6a443a643e40951', '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626'],
  ['OfficialStockRegistryV1', '0xb214ffa2d11f6b0bd117bc41d6d51800c52ef928', '0x4ad8a16533cb665d9c0061621dff8534b8071d4c052e92303669cc41d1171454'],
  ['ApprovedQuoteRegistry', '0x93c8ce0e44c2ed39399ff12821454d681c0b5353', '0x649ffc57f244a8b2fd723f49113613898c8196849304a74af48cf4e5dcce1ce7'],
  ['TickerGardenBaselineRegistry', '0x78c1526860e0da4acdc6f32a4f4f8d45bbde0933', '0xa50be2ddbb1c9539ae0ae7f781f539362978aa51119841120b655cf2f7129a3a'],
  ['LaunchTemplateRegistry', '0x7b0be869b940c61cbb1cb90655dc34aac329fc63', '0xe31e9bbd7949e9a748688ba11ec9691c1c780da74fc9b390be39d35456e42944'],
  ['LaunchConfigResolver', '0xec83f932b08f8cb6120b2e38eba5b9cea9c9a4ad', '0xab75613e4c942e7106f5201ef620e55114709f8b81f213cb78880148935c9f8d'],
  ['MemeStockGauge', '0x576a9311ae4c142269ed3d9047893682a3350037', '0x699e74280e4c14847f5a3b71b37b8e9aeb4db7d8aab13a0463cc15f3c34c81b0'],
  ['LaunchAndBuyRouter', '0x0923719faaf02f1e512fb62f69bda312447cbd60', '0x0224620ebfad503ac0ea04f36a7e0d9c9f1d85eb1466090b2f49728ff6e516e3'],
  ['MarketRegistryV1', '0x03f8a6e75ce7bf707076d7339968f8fdf5703b16', '0x2944d48b578c583511c37f71f6ddc811201b3dfb25b4fa920173c70f443d43fb'],
  ['CreatorRevenueRegistry', '0x789aeed3c72e58cf09ad0f325ec62148a958a0af', '0x5db192de5e3adbc9c618a68611c4059b2071ff8da8ecf5f3f1f0b950d8ed88e4'],
  ['AllocationManager', '0xe737f06bffa94f4bd9eb233ca344fdea4d796452', '0xfc242b0e30cd42d219cee0f50c0092b162ba112131276b90824cc31dae894c30'],
  ['UserStockVault', '0xa608276c7273373a7961cdb01e7505c385744eaa', '0xa939e2b5b8f2eada3b6421d4937bf5c59b6e4d54282eea0bb6933e03f8cc4282'],
  ['HolderRewardsDistributorV1', '0x88dfa615583abfbffed04a40e902d41cc550c992', '0x5fdcb2fad4292f8f0920b8b8d9eb31418fbe3fc74b2baec8256ebe3434fe6ce5'],
  ['ProtocolFeeVault', '0x9cba4929745077198393f09ad2f409db43c90da9', '0x901c78e4746305d5aae770f8b600ef083b151fa855faa5dc7e7c68708846afc6'],
  ['TickerGardenMemeHook', '0xf5e89af0949745fe497b22d1214fea3daa75a044', '0x3046cd98e4e8850911bfb3b1781548dbd866ac67224315cae08c5a30e48b5b06'],
  ['GraduationExecutor', '0xed1e7c1256e848d520677a017263d75f5377706c', '0xf82170cfd71aadb74f88a3e606f3c7a52f91006b9f4cdf3777532466ad51c7f8'],
  ['TickerGardenFactoryV1', '0x496a3cb9fd8a045c590f311e948b2b4382f17904', '0xeb1bfed084ffe0480e218009629f48676dc591de3d666bf1227ba80ea2404a9b'],
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
