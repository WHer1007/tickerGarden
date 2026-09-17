import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbiParameters, erc20Abi, type Hex } from 'viem';
import { DirectMarkets } from '../src/v1/directMarkets.ts';
import { currentV4Abis as directAbis } from '../src/v1/generated/abis.ts';
import { parseIntegrationBootstrap } from '../src/v1/integrationBootstrap.ts';

const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/integration/rh-f72a2cdf.json', import.meta.url), 'utf8')) as any;
const b = parseIntegrationBootstrap(raw, 46630, {
  factoryAddress: raw.factory,
  launchRouterAddress: raw.bindings.launchRouter,
  allocationManagerAddress: raw.bindings.allocationManager,
  protocolFeeVaultAddress: raw.bindings.protocolFeeVault,
  creatorRevenueRegistryAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
  treasuryDistributorAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
});
const id = `0x${'1'.repeat(64)}` as Hex;
const factory = raw.factory as `0x${string}`;
const meme = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const curve = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const gauge = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const quote = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const hash = `0x${'a'.repeat(64)}` as Hex;

function createdLog(address = factory, marketId = id) {
  const args = {
    marketId, assetUid: `0x${'2'.repeat(64)}` as Hex, memeToken: meme, curve, gauge, quoteAsset: quote,
    tickerGardenBaselineId: b.configs.find(c => c.kind === 'baseline')!.id as Hex,
    quoteAssetConfigId: b.configs.find(c => c.kind === 'quote')!.id as Hex,
    expectedEconomics: `0x${'3'.repeat(64)}` as Hex,
  };
  const topics = encodeEventTopics({ abi: directAbis.TickerGardenFactoryV1, eventName: 'MarketCreated', args });
  const data = encodeAbiParameters(parseAbiParameters('address,address,address,bytes32,bytes32,bytes32'), [curve, gauge, quote, args.tickerGardenBaselineId, args.quoteAssetConfigId, args.expectedEconomics]);
  return { address, topics: topics as Hex[], data: data as Hex, blockNumber: 100n, blockHash: hash, transactionHash: `0x${'b'.repeat(64)}` as Hex, transactionIndex: 0, logIndex: 0 };
}

function reader(counter: { calls: number },options:Readonly<{stakingEnabled?:boolean;activeStake?:bigint}>={}) {
  return async (_address: any, _abi: any, name: string, _args: readonly unknown[], block: bigint) => {
    encodeFunctionData({abi:_abi,functionName:name,args:_args});
    if(name==='graduationExecutor')assert.equal(_address,b.bindings.marketRegistry);
    counter.calls++;
    assert.equal(block, 120n);
    if (name === 'market') return { config: { assetUid: `0x${'2'.repeat(64)}`, curve, memeToken: meme, gauge, quoteAsset: quote, quoteAssetConfigId: b.configs.find(c => c.kind === 'quote')!.id, tickerGardenBaselineId: b.configs.find(c => c.kind === 'baseline')!.id, launchTemplateId: b.configs.find(c => c.kind === 'template')!.id, creatorTaxBps: 250, creatorFeesToHolders: false, burnMemeFees: false, lpFeePips: 2000, stakingEnabled: options.stakingEnabled??false }, runtime: { sourceVersion: 1, launchPhase: 0, poolId: `0x${'0'.repeat(64)}` } };
    if (name === 'canonicalRoute') return { poolKey: null, swapRouter: raw.bindings.launchRouter, quoter: raw.bindings.launchRouter, hook: raw.bindings.launchRouter, launchLocker: raw.bindings.launchRouter, curveTradingEnabled: true, poolTradingEnabled: false, sourceVersion: 1 };
    if (name === 'graduationExecutor') return raw.bindings.launchRouter;
    if (name === 'readyToGraduate') return false;
    if (name === 'name') return 'Local Garden';
    if (name === 'symbol') return 'LGDN';
    if (name === 'metadataURI') return `ipfs://b${'a'.repeat(58)}`;
    if (name === 'deployedAt') return 1_700_000_000n;
    if (name === 'creator') return '0x4444444444444444444444444444444444444444';
    if (name === 'effectiveTotalActiveStock') return options.activeStake??0n;
    return 0n;
  };
}

test('DirectMarkets observes Factory MarketCreated and reads current head state', async () => {
  const counter = { calls: 0 };
  const dm = new DirectMarkets(b, reader(counter), async () => ({ number: 120n, hash }));
  dm.observe(createdLog());
  const result = await dm.market(id);
  assert.equal(result.observation, 'direct-chain');
  assert.equal(result.sync.finality, 'head');
  assert.equal(result.sync.blockNumber, '120');
  assert.equal(result.market.marketId, id);
  assert.deepEqual(result.market.identity?.name, 'Local Garden');
  assert.equal(result.market.identity?.symbol, 'LGDN');
  assert.equal(result.market.creator, '0x4444444444444444444444444444444444444444');
  assert.deepEqual(result.market.directFeeConfig,{creatorTaxBps:250,activeStakeRaw:'0'});
  assert.equal(result.market.lpFeePips,2000);
  const once = counter.calls;
  await dm.market(id);
  assert.equal(counter.calls, once, '15 second cache should avoid repeated reads');
});

test('DirectMarkets pins the active staking amount used by fee allocation to the same head',async()=>{
  const dm=new DirectMarkets(b,reader({calls:0},{stakingEnabled:true,activeStake:42n}),async()=>({number:120n,hash}));
  dm.observe(createdLog());
  const result=await dm.market(id);
  assert.equal(result.market.directFeeConfig?.activeStakeRaw,'42');
});

test('DirectMarkets rejects unknown markets and non-Factory same-name events', async () => {
  const dm = new DirectMarkets(b, reader({ calls: 0 }), async () => ({ number: 120n, hash }));
  dm.observe(createdLog('0x9999999999999999999999999999999999999999'));
  await assert.rejects(() => dm.market(id), /not been observed/);
  await assert.rejects(() => dm.market(`0x${'4'.repeat(64)}` as Hex));
});


test('cold market discovery is coalesced and remembered for later reads', async () => {
  let discoveries=0;const counter={calls:0};
  const dm=new DirectMarkets(b,reader(counter),async()=>({number:120n,hash}),undefined,async requested=>{discoveries++;assert.equal(requested,id);dm.observe(createdLog());});
  const [first,second]=await Promise.all([dm.market(id),dm.market(id)]);
  assert.equal(first.market.marketId,id);assert.equal(second,first);assert.equal(discoveries,1);
  dm.cache.clear();await dm.market(id);assert.equal(discoveries,1);
});

test('concurrent distinct markets share one head read', async () => {
  const secondId = `0x${'5'.repeat(64)}` as Hex;
  const counter = { calls: 0, heads: 0 };
  let release!: (value: { number: bigint; hash: Hex }) => void;
  const head = new Promise<{ number: bigint; hash: Hex }>(resolve => { release = resolve; });
  const dm = new DirectMarkets(b, reader(counter), async () => { counter.heads++; return head; });
  dm.observe(createdLog(factory, id));
  dm.observe(createdLog(factory, secondId));
  const first = dm.market(id);
  const second = dm.market(secondId);
  release({ number: 120n, hash });
  await Promise.all([first, second]);
  assert.equal(counter.heads, 1);
});

test('failed head reads are not cached and retry', async () => {
  let heads = 0;
  const dm = new DirectMarkets(b, reader({ calls: 0 }), async () => {
    heads++;
    if (heads === 1) throw new Error('temporary head failure');
    return { number: 120n, hash };
  });
  dm.observe(createdLog());
  await assert.rejects(() => dm.market(id), /temporary head failure/);
  const result = await dm.market(id);
  assert.equal(result.market.marketId, id);
  assert.equal(heads, 2);
});

test('a confirmed receipt invalidates the shared head before the next state read', async () => {
  let heads=0;
  const dm=new DirectMarkets(b,reader({calls:0}),async()=>{heads++;return {number:120n,hash};});
  dm.observe(createdLog());
  await dm.market(id);
  dm.receipt({logs:[]} as unknown as Parameters<DirectMarkets['receipt']>[0]);
  await dm.market(id);
  assert.equal(heads,2);
});

test('confirmed creation prepares full detail and initial cap inputs without any read API',async()=>{
 const {prepareCreatedMarket,preparedCreatedMarket}=await import('../src/v1/createdMarket.ts');
 const log={...createdLog(),blockNumber:120n};
 const foundation={sync:{chainId:46630},bindings:b.bindings,quotes:b.configs.filter(c=>c.kind==='quote'),baseline:b.configs.filter(c=>c.kind==='baseline'),templates:b.configs.filter(c=>c.kind==='template')};
 const read=reader({calls:0});
 const ctx:any={foundation,runtimeConfig:{contracts:{available:true,value:{factoryAddress:factory,protocolFeeVaultAddress:b.bindings.protocolFeeVault}},releaseCatalog:[]},publicClient:{getChainId:async()=>46630,getBlock:async()=>({number:120n,hash,timestamp:123n}),readContract:async({address,abi,functionName,args=[],blockNumber}:any)=>functionName==='getReserves'?[2n*10n**18n,100n*10n**18n]:functionName==='totalSupply'?100n*10n**18n:read(address,abi,functionName,args,blockNumber)}};
 const transfer=(from:`0x${string}`,to:`0x${string}`,value:bigint)=>({...log,address:meme,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters(parseAbiParameters('uint256'),[value])});
 const user='0x4444444444444444444444444444444444444444';
 await prepareCreatedMarket(ctx,{status:'success',blockNumber:120n,blockHash:hash,logs:[log,transfer(quote,curve,100n*10n**18n),transfer(curve,user,10n*10n**18n),transfer(curve,b.bindings.protocolFeeVault,5n*10n**18n)]} as any);
 const prepared=preparedCreatedMarket(id)!;assert.ok(prepared);
 const detail=await prepared.request;
 assert.equal(detail.market.marketId,id);assert.ok(detail.market.identity);assert.equal(detail.sync.finality,'head');
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(prepared.overview?.price,'0.02');assert.equal(prepared.overview?.supply,'100000000000000000000');
});

test('creation rejects a reorganized receipt and mismatched network',async()=>{
 const {prepareCreatedMarket}=await import('../src/v1/createdMarket.ts');
 const ctx:any={foundation:{bindings:b.bindings,sync:{chainId:46630}},runtimeConfig:{contracts:{available:true,value:{factoryAddress:factory}}},publicClient:{getBlock:async()=>({hash}),getChainId:async()=>4663}};
 await assert.rejects(()=>prepareCreatedMarket(ctx,{status:'success',blockNumber:120n,blockHash:`0x${'c'.repeat(64)}`} as any),/canonical/);
 await assert.rejects(()=>prepareCreatedMarket(ctx,{status:'success',blockNumber:120n,blockHash:hash} as any),/chain mismatch/);
});

 test('optional staking statistics cannot prevent the fresh creation detail read',async()=>{
 const read=reader({calls:0},{stakingEnabled:true});
 const dm=new DirectMarkets({...b,skipStake:true},async(a,abi,name,args,block)=>{assert.notEqual(name,'effectiveTotalActiveStock');return read(a,abi,name,args,block);},async()=>({number:120n,hash}));
 dm.observe(createdLog());const result=await dm.market(id);assert.ok(result.market.identity);assert.equal(result.market.directFeeConfig?.activeStakeRaw,'0');
 });
