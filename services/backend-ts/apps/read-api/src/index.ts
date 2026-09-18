import {readCreatorRewards} from '../../../packages/read-store/src/creator-rewards.ts';
import {readStakeSummary} from '../../../packages/history-projector/src/stake-summary.ts';
import {readLaunchReadiness} from '../../../packages/confirmed-display/src/read.ts';
import {readStatsDisplay} from '../../../packages/confirmed-display/src/stats.ts';
import {readExploreBootstrap,readExploreCards,readExplorePage} from '../../../packages/confirmed-display/src/explore.ts';
import {rpcScope} from './rpc-scope.ts';
import {createMarketEvents} from './market-events.ts';
import {readMarketPageBootstrap} from '../../../packages/confirmed-display/src/read.ts';
import {getConversionQuote,assertConversionIntent,type ConversionIntent,TRADE_NATIVE,TRADE_USDG} from '../../../packages/chain/src/quote-purchase/zeroex.ts';
import {routes as conversionStocks} from '../../../packages/chain/src/quote-purchase/routes.ts';
import {quotePurchase} from '../../../packages/chain/src/quote-purchase/quote.ts';
import {rpcPolicy} from '../../../packages/chain/src/rpc-policy.ts';
import {CURRENT_CHAIN_ID,assertRuntimeEnvironment} from '../../../packages/runtime-deployment/src/index.ts';
import {readProtocolStatistics} from '../../../packages/statistics-store/src/snapshot.ts';
import { createHash } from 'node:crypto';
import { sharedStatistics } from './statistics-cache.ts';
import { createReadAdmission } from './read-admission.ts';
import { readHolderSnapshots } from '../../../packages/read-store/src/holder-snapshots.ts';
import type { Pool } from 'pg';
import type { Context } from 'hono';
import { createServiceApp } from '../../../packages/http/src/index.ts';
import { createDatabasePool } from '../../../packages/db/src/index.ts';
import { CURRENT_ACTIVATION_BLOCK, CURRENT_RELEASE_ID } from '../../../packages/events/src/index.ts';
import {
  PublicationChangedError, PublicationUnavailableError, readCreatorMarkets, readHolderMarkets, readPublishedConfigPage, readPublishedMarketPage, readPublishedRecord,
  readRecentMarketVersion, readPublishedSync, readPublishedUserPage, readLaunchRecovery, readMemeFeeBurns, readRewardHistory, readSnapshotUpdates, readUserActivity, readWalletHolderMarkets, unavailableSync,
  type MarketPageFilter,
} from '../../../packages/read-store/src/index.ts';
import { RpcTransport, type DeploymentIdentity } from '../../../packages/chain/src/index.ts';
import { observeTransaction } from '../../../packages/transaction-observer/src/index.ts';
import { readMarketCandles, readMarketHolders, readMarketTrades, readTokenDetail } from '../../../packages/analytics-store/src/index.ts';
import { readDisplayPrices, readGlobalHolders, readGlobalSeries, readGlobalStatistics, readMarketDisplayStatistics, readMarketStatistics, readStatisticsPrices } from '../../../packages/statistics-store/src/index.ts';

interface ReadApiOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly pool?: Pool;
  readonly deployment?: DeploymentIdentity;
  readonly primary?: RpcTransport;
  readonly secondary?: RpcTransport;
}

export function createReadApiApp(options: ReadApiOptions = {}) {
  const env = options.env ?? process.env;
  assertRuntimeEnvironment(env);
  const rpc = rpcPolicy(env);
  const app = createServiceApp({ kind: 'read-api', env, requiredEnvironmentKeys: ['TG_READ_DATABASE_URL', 'TG_CURSOR_SECRET'] });
  const deployment: DeploymentIdentity = options.deployment ?? {
    environment: environmentName(env.TG_ENVIRONMENT), chainId: CURRENT_CHAIN_ID, deploymentDigest: CURRENT_RELEASE_ID, activationBlock: CURRENT_ACTIVATION_BLOCK,
  };
  let ownedPool: Pool | undefined;
  const pool = () => ownedPool ??= options.pool ?? createDatabasePool(env.TG_READ_DATABASE_URL ?? '', {}, {role:'read-api',env}).pool;
  const schemaName = env.TG_DATABASE_SCHEMA;
  let eventPool:Pool|undefined;
  const marketEvents=createMarketEvents(()=>eventPool??=options.pool??createDatabasePool(env.TG_READ_DATABASE_URL??'',{max:1},{role:'market-events',env}).pool,deployment,schemaName);
  // Share only in-flight public version reads. Never cache finality decisions.
  const updateReads = new Map<string,Promise<unknown>>();
  const shareRead = createReadAdmission({ concurrency: 8, maxPending: 128,
    unavailable: () => new PublicationUnavailableError('Public read capacity is busy; retry shortly') });
  // Global scans share one bounded lane so competing chart/Holder scans cannot exhaust the pool.
  const shareGlobalRead = createReadAdmission({ concurrency: 1, maxPending: 8,
    unavailable: () => new PublicationUnavailableError('Global statistics capacity is busy; retry shortly') });

  const cachedGlobalRead=<T>(key:string,build:(readPool:Pool)=>Promise<T>)=>shareGlobalRead(key,()=>sharedStatistics({pool:pool(),deployment,...(schemaName?{schemaName}:{})},key,build));

  const cursorSecret = env.TG_CURSOR_SECRET ?? '';
  const primary = options.primary ?? (env.TG_READ_RPC_URL ? new RpcTransport({ url: env.TG_READ_RPC_URL }) : undefined);
  const secondary = options.secondary ?? (rpc.verificationUrl ? new RpcTransport({ url: rpc.verificationUrl }) : undefined);

  app.use('/v1/*', async (context, next) => {
    await next(); const path = context.req.path;
    const privateRead = path.includes('/users/') || path.includes('holder-snapshots') || path.includes('creator-rewards') || path.includes('creator-markets') || (path.includes('reward-history') || path.includes('reward-summary')) || path.includes('/wallet-holder-markets') || path.includes('/transactions/');
    const activity = path.endsWith('/detail') && context.req.query('section')==='activity';
    const priceCatalog = path.endsWith('/prices/references') || path.endsWith('/statistics-prices');
    const revision = context.req.query('revision');
    const dynamicRanking = path==='/v1/markets'&&['marketCapUsd_desc','recentBuy_desc'].includes(context.req.query('sort')??'');
    const immutableRevision = context.res.status >= 200 && context.res.status < 300
      && typeof revision === 'string' && /^(0|[1-9][0-9]*):0x[0-9a-f]{64}$/.test(revision);
    context.header('cache-control', context.res.status < 200 || context.res.status >= 300 || privateRead || priceCatalog || path.startsWith('/v1/explore') || (path==='/v1/quote-purchase'||path==='/v1/trade-conversion') || path.endsWith('/events') || path==='/v1/rpc-scope' || path.endsWith('/launch-readiness') || path.endsWith('/page') || path.endsWith('/detail') || activity || context.req.query('includeRecent')==='true' || path.endsWith('/updates') || dynamicRanking || path==='/v1/market-display-statistics' || path==='/v1/protocol-statistics' || path==='/v1/stats/display'
      ? 'no-store'
      : immutableRevision
        ? 'public, max-age=300, s-maxage=31536000, immutable'

        : 'public, max-age=5, s-maxage=15, stale-while-revalidate=30');
  });

  const purchaseReads=createReadAdmission({concurrency:4,maxPending:8,unavailable:()=>new PublicationUnavailableError('Purchase quotes are busy')});
  app.get('/v1/rpc-scope',async context=>{
    try{
      const q=context.req.query();
      if(Object.keys(q).some(k=>k!=='addresses'))throw Error('Invalid query');
      const addresses=[...new Set((q.addresses??'').split(','))];
      if(!addresses.length||addresses.length>60||addresses.some(a=>!/^0x[0-9a-f]{40}$/.test(a)))throw Error('Invalid addresses');
      const targets=await shareRead('rpc-scope:'+addresses.slice().sort().join(','),()=>rpcScope(pool(),deployment,addresses,schemaName));
      return context.json({chainId:deployment.chainId,targets});
    }catch{return context.json({error:'rpc_scope_unavailable'},400);}
  });

  app.get('/v1/quote-purchase',async context=>{
    try {
      const q=context.req.query();
      if(Object.keys(q).some(key=>!['chainId','token','amountOut'].includes(key)))return context.json({error:'invalid_query',message:'Check the purchase request.'},400);
      if(q.chainId!=='4663'||deployment.chainId!==4663||!/^0x[0-9a-fA-F]{40}$/.test(q.token??''))return context.json({error:'invalid_query',message:'Choose a supported paired asset.'},400);
      if(!/^[1-9][0-9]{0,38}$/.test(q.amountOut??'')||BigInt(q.amountOut!)>=2n**128n)return context.json({error:'invalid_query',message:'Enter a valid purchase amount.'},400);
      if(!primary)throw Error('RPC unavailable');
      const result=await purchaseReads(`${q.token!.toLowerCase()}:${q.amountOut}`,()=>quotePurchase(primary,q.token!,q.amountOut!));
      return context.json(result);
    }catch{return context.json({error:'quote_unavailable',message:'This purchase could not be quoted. Try again shortly.'},503);}
  });

  app.get('/v1/trade-conversion',async context=>{
    const q=context.req.query();
    try {
      if(Object.keys(q).some(k=>!['chainId','sellToken','buyToken','sellAmount','taker'].includes(k)))throw Error();
      const intent={...q,chainId:Number(q.chainId)} as ConversionIntent;assertConversionIntent(intent);
      if(deployment.chainId!==4663||![TRADE_NATIVE,TRADE_USDG,...Object.keys(conversionStocks)].includes(intent.buyToken.toLowerCase()))throw Error();
    }catch{return context.json({error:'invalid_query',message:'Choose a supported payment asset and amount.'},400);}
    try {
      const intent={...q,chainId:4663} as ConversionIntent;
      const result=await purchaseReads('conversion:'+JSON.stringify(intent),()=>getConversionQuote(intent,env.ZEROX_API_KEY??''));
      return context.json(result);
    }catch{return context.json({error:'conversion_unavailable',message:'This payment route is unavailable. Try again or pay with the paired asset.'},503);}
  });
  app.all('/v1/trade-conversion',context=>{context.header('cache-control','no-store');return context.json({error:'method_not_allowed',message:'Use GET.'},405);});

  app.all('/v1/quote-purchase',context=>context.json({error:'method_not_allowed',message:'Use GET.'},405));

  app.get('/health', async (context) => {
    let sync = await unavailableSync(deployment);
    try { sync = await readPublishedSync({ pool: pool(), deployment, scope: 'markets', ...(schemaName ? { schemaName } : {}) }); } catch (error) {
      if (!(error instanceof PublicationUnavailableError)) throw error;
    }
    context.header('cache-control', 'public, max-age=2, s-maxage=5, stale-while-revalidate=10');
    return context.json({ executionSpecId: 'V1-EXEC-11' as const, status: 'read-api' as const, readApiImplemented: true as const,
      productRuntimeImplemented: true as const, custody: false as const, transactionSubmission: false as const, sync });
  });

  app.get('/v1/holder-snapshots', async context => {
    try {
      const q=context.req.query();rejectUnknown(q,['chainId','distributor','marketId','account','cursor']);
      if(q.chainId!==String(deployment.chainId)||!/^0x[0-9a-f]{64}$/.test(q.marketId??''))throw Error('invalid snapshot identity');
      return context.json(await shareRead('holder-snapshots:'+JSON.stringify(q),()=>readHolderSnapshots({pool:pool(),deployment,distributor:parseAddress(q.distributor??''),account:parseAddress(q.account??''),marketId:q.marketId as `0x${string}`,secret:cursorSecret,...(q.cursor?{cursor:q.cursor}:{}),...(schemaName?{schemaName}:{})})));
    }catch(error){
      const requestId=context.get('requestId');
      if(error instanceof PublicationChangedError)return context.json({error:'snapshot_page_changed',message:error.message,requestId},409);
      if(error instanceof PublicationUnavailableError)return context.json({error:'snapshot_unavailable',message:error.message,requestId},503);
      if(error instanceof Error&&/invalid|cursor|query/.test(error.message))return context.json({error:'invalid_query',message:error.message,requestId},400);
      throw error;
    }
  });
  app.all('/v1/holder-snapshots',context=>context.json({error:'method_not_allowed',message:'Use GET',requestId:context.get('requestId')},405));

  app.get('/v1/explore/bootstrap',async context=>{
    try {rejectUnknown(context.req.query(),[]);return context.json(await shareRead('explore:bootstrap',()=>readExploreBootstrap({pool:pool(),deployment,...(schemaName?{schemaName}:{})})));}
    catch(error){return readError(context,error,deployment);}
  });
  app.get('/v1/explore/cards',async context=>{
    try {const q=context.req.query();rejectUnknown(q,['markets']);const markets=[...new Set((q.markets??'').split(','))].sort();return context.json(await shareRead('explore:cards:'+markets.join(','),()=>readExploreCards({pool:pool(),deployment,...(schemaName?{schemaName}:{})},markets)));}
    catch(error){return readError(context,error,deployment);}
  });
  app.get('/v1/explore/events',context=>marketEvents(context,'*'));
  app.get('/v1/explore',async context=>{
    try {const query=context.req.query();return context.json(await shareRead('explore:'+JSON.stringify(query),()=>readExplorePage({pool:pool(),deployment,secret:cursorSecret,query,...(schemaName?{schemaName}:{})})));}
    catch(error){return readError(context,error,deployment);}
  });

  app.get('/v1/markets', async (context) => {
    try {
      const query = context.req.query();
      rejectUnknown(query, ['assetUid', 'marketId', 'memeToken', 'launchPhase', 'search', 'createdFrom', 'createdTo', 'stakingEnabled', 'sort', 'revision', 'limit', 'cursor', 'includeRecent']);
      if(query.stakingEnabled!==undefined&&!['true','false'].includes(query.stakingEnabled))throw Error('invalid staking filter');
      const filter: MarketPageFilter = {
        ...(query.stakingEnabled!==undefined?{stakingEnabled:query.stakingEnabled==='true'}:{}),
        ...(query.assetUid ? { assetUid: query.assetUid.toLowerCase() as `0x${string}` } : {}),
        ...(query.marketId ? { marketId: query.marketId.toLowerCase() as `0x${string}` } : {}),
        ...(query.memeToken ? { memeToken: query.memeToken.toLowerCase() as `0x${string}` } : {}),
        ...(query.launchPhase !== undefined ? { launchPhase: parsePhase(query.launchPhase) } : {}),
        ...(query.search ? { search: query.search.trim() } : {}), ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
        ...(query.createdTo ? { createdTo: query.createdTo } : {}), ...(query.sort ? { sort: parseSort(query.sort) } : {}),
      };
      const page = await shareRead(`markets:${JSON.stringify(query)}`,()=>readPublishedMarketPage({
        pool: pool(), deployment, filter, secret: cursorSecret, includeRecent:parseIncludeRecent(query.includeRecent),
        ...(query.revision ? { revision: query.revision } : {}), ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: parseLimit(query.limit) } : {}), ...(schemaName ? { schemaName } : {}),
      }));
      return context.json(page);
    } catch (error) { return readError(context, error, deployment); }
  });

  app.get('/v1/updates', async (context) => {
    try { const query = context.req.query(); rejectUnknown(query, ['since']);
      const key=query.since??'';
      let pending=updateReads.get(key);
      if(!pending){
        pending=Promise.all([readSnapshotUpdates({pool:pool(),deployment,...(query.since?{since:query.since}:{}),...(schemaName?{schemaName}:{})}),readRecentMarketVersion({pool:pool(),deployment,...(schemaName?{schemaName}:{})})]).then(([update,recentVersion])=>({...update,recentVersion}));
        if(updateReads.size<128){updateReads.set(key,pending);const current=pending;void pending.finally(()=>{if(updateReads.get(key)===current)updateReads.delete(key);}).catch(()=>{});}
      }
      return context.json(await pending);
    } catch (error) { return readError(context, error, deployment); }
  });

  app.get('/v1/markets/:marketId/events',async context=>{try{return await marketEvents(context,parseMarketId(context.req.param('marketId')));}catch{return context.json({error:'events_unavailable'},503);}});

  app.get('/v1/markets/:marketId/launch-readiness',async context=>{try{rejectUnknown(context.req.query(),[]);const marketId=parseMarketId(context.req.param('marketId'));return context.json(await shareRead('launch-readiness:'+marketId,()=>readLaunchReadiness(pool(),deployment,marketId,schemaName)));}catch(error){return analyticsError(context,error,'candle');}});

  app.get('/v1/markets/:marketId/page',async context=>{
    try{rejectUnknown(context.req.query(),[]);const marketId=parseMarketId(context.req.param('marketId'));const page=await shareRead(analyticsReadKey('market-page',context,deployment,marketId),()=>readMarketPageBootstrap(pool(),deployment,marketId,schemaName));return page?context.json(page):context.json({error:'market_not_found',message:'Market details are not ready'},404);}
    catch(error){return readError(context,error,deployment);}
  });

  app.get('/v1/markets/:marketId', async (context) => {
    try {
      const query = context.req.query();
      rejectUnknown(query, ['revision','includeRecent']);
      const marketId = context.req.param('marketId').toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(marketId)) throw new Error('invalid marketId');
      const result = await readPublishedRecord({
        pool: pool(), deployment, scope: 'markets', identity: marketId, includeRecent:parseIncludeRecent(query.includeRecent),
        ...(query.revision ? { revision: query.revision } : {}), ...(schemaName ? { schemaName } : {}),
      });
      if (!result.item) return context.json({ error: 'market_not_found', message: 'Market is not present in this complete publication', sync: result.sync }, 404);
      return context.json({ market: result.item, sync: result.sync });
    } catch (error) { return readError(context, error, deployment); }
  });

  app.get('/v1/config/:kind', async (context) => {
    try {
      const query = context.req.query();
      rejectUnknown(query, ['revision', 'limit', 'cursor']);
      const kind = parseConfigKind(context.req.param('kind'));
      return context.json(await readPublishedConfigPage({
        pool: pool(), deployment, kind, secret: cursorSecret,
        ...(query.revision ? { revision: query.revision } : {}), ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: parseLimit(query.limit) } : {}), ...(schemaName ? { schemaName } : {}),
      }));
    } catch (error) { return readError(context, error, deployment); }
  });

  app.get('/v1/users/:address/accounts', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['revision', 'limit', 'cursor']);
      return context.json(await readPublishedUserPage({ pool: pool(), deployment, kind: 'accounts', user: parseAddress(context.req.param('address')),
        secret: cursorSecret, ...(query.revision ? { revision: query.revision } : {}), ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: parseLimit(query.limit) } : {}), ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return accountError(context, error, deployment); }
  });

  app.get('/v1/users/:address/positions', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['revision', 'limit', 'cursor']);
      return context.json(await readPublishedUserPage({ pool: pool(), deployment, kind: 'positions', user: parseAddress(context.req.param('address')),
        secret: cursorSecret, ...(query.revision ? { revision: query.revision } : {}), ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: parseLimit(query.limit) } : {}), ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return accountError(context, error, deployment); }
  });

  app.get('/v1/users/:address/activity', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['limit', 'cursor']);
      return context.json(await readUserActivity({ pool: pool(), deployment, account: parseAddress(context.req.param('address')), secret: cursorSecret,
        ...(query.limit ? { limit: parseLimit(query.limit) } : {}), ...(query.cursor ? { cursor: query.cursor } : {}), ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return historyError(context, error); }
  });

  app.get('/v1/creator-rewards',async context=>{
    try {const q=context.req.query();rejectUnknown(q,['marketId','account','cursor','epoch']);if(q.epoch&&(!/^[1-9][0-9]*$/.test(q.epoch)||Number(q.epoch)>4294967295))throw Error('invalid Creator epoch');if(!q.marketId||!q.account)throw Error('invalid Creator query');
      return context.json(await shareRead('creator-rewards:'+JSON.stringify(q),()=>readCreatorRewards({pool:pool(),deployment,marketId:parseMarketId(q.marketId!),account:parseAddress(q.account!),secret:cursorSecret,...(q.epoch?{epoch:Number(q.epoch)}:{}),...(q.cursor?{cursor:q.cursor}:{}),...(schemaName?{schemaName}:{})})));
    }catch(error){return historyError(context,error);}
  });
  app.get('/v1/creator-markets', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['address', 'limit', 'cursor']); if (!query.address) throw new Error('invalid address');
      return context.json(await readCreatorMarkets({ pool: pool(), deployment, address: parseAddress(query.address), secret: cursorSecret,
        ...(query.limit ? { limit: parseLimit(query.limit) } : {}), ...(query.cursor ? { cursor: query.cursor } : {}), ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return historyError(context, error); }
  });

  app.get('/v1/holder-markets', async (context) => {
    try { const query = context.req.query(); rejectUnknown(query, ['q']); return context.json(await readHolderMarkets({ pool: pool(), deployment,
      query: query.q ?? '', ...(schemaName ? { schemaName } : {}) })); } catch (error) { return historyError(context, error); }
  });

  app.get('/v1/wallet-holder-markets', async (context) => {
    try { const query = context.req.query(); rejectUnknown(query, ['account']); if (!query.account) throw new Error('invalid account');
      return context.json(await readWalletHolderMarkets({ pool: pool(), deployment, account: parseAddress(query.account), ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return historyError(context, error); }
  });

  app.get('/v1/staker-reward-summary',async context=>{
    try { const query=context.req.query();rejectUnknown(query,['marketId','account']);if(!query.marketId||!query.account)throw Error('invalid summary query');
      return context.json(await shareRead(`stake-summary:${query.marketId}:${query.account}`,()=>readStakeSummary({pool:pool(),deployment,marketId:parseMarketId(query.marketId!),account:parseAddress(query.account!),...(schemaName?{schemaName}:{})})));
    } catch(error){return historyError(context,error);}
  });

  for (const kind of ['holder', 'staker'] as const) app.get(`/v1/${kind}-reward-history`, async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['marketId', 'account', 'throughBlock']);
      if (!query.marketId || !query.account || !query.throughBlock) throw new Error('invalid reward history query');
      return context.json(await readRewardHistory({ pool: pool(), deployment, kind, marketId: parseMarketId(query.marketId), account: parseAddress(query.account),
        throughBlock: parseBlock(query.throughBlock), ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return historyError(context, error); }
  });

  app.get('/v1/meme-fee-burns', async context => {
    try { const query=context.req.query();rejectUnknown(query,['marketId']);if(!query.marketId)throw new Error('invalid market id');
      return context.json(await readMemeFeeBurns({pool:pool(),deployment,marketId:parseMarketId(query.marketId),...(schemaName?{schemaName}:{})}));
    } catch(error) {return historyError(context,error);}
  });

  app.get('/v1/launch-recovery', async (context) => {
    try { const query = context.req.query(); rejectUnknown(query, ['marketId']); if (!query.marketId) throw new Error('invalid market id');
      context.header('cache-control', 'no-store'); return context.json(await readLaunchRecovery({ pool: pool(), deployment, marketId: parseMarketId(query.marketId), ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return historyError(context, error); }
  });

  app.get('/v1/transactions/:txHash', async (context) => {
    try {
      rejectUnknown(context.req.query(), []); const transactionHash = parseMarketId(context.req.param('txHash'));
      if (!primary || !secondary) throw new PublicationUnavailableError('transaction RPC observers are unavailable');
      context.header('cache-control', 'no-store');
      return context.json(await observeTransaction({ pool: pool(), deployment, transactionHash, primary, secondary, ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return transactionError(context, error); }
  });

  app.get('/v1/markets/:marketId/trades', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['from', 'to', 'limit', 'cursor']);
      const marketId = parseMarketId(context.req.param('marketId'));
      if (query.from === undefined || query.to === undefined) throw new Error('invalid trade window');
      const from = parseTimestamp(query.from), to = parseTimestamp(query.to);
      if (from >= to) throw new Error('invalid trade window');
      const readKey = analyticsReadKey('trades', context, deployment, marketId);
      return context.json(await shareRead(readKey, () => readMarketTrades({ pool: pool(), deployment, marketId, from, to,
        limit: query.limit ? parseLimit(query.limit) : 50, secret: cursorSecret, ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(schemaName ? { schemaName } : {}) })));
    } catch (error) { return analyticsError(context, error, 'trade'); }
  });

  app.get('/v1/markets/:marketId/candles', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['interval', 'from', 'to']);
      if (query.interval === undefined || query.from === undefined || query.to === undefined) throw new Error('invalid candle query');
      const marketId = parseMarketId(context.req.param('marketId'));
      const interval = parseInterval(query.interval), from = parseTimestamp(query.from), to = parseTimestamp(query.to);
      return context.json(await shareRead(analyticsReadKey('candles', context, deployment, marketId), () => readMarketCandles({ pool: pool(), deployment, marketId,
        interval, from, to,
        ...(schemaName ? { schemaName } : {}) })));
    } catch (error) { return analyticsError(context, error, 'candle'); }
  });

  app.get('/v1/markets/:marketId/holders', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['limit', 'cursor']);
      const marketId = parseMarketId(context.req.param('marketId'));
      const limit = query.limit ? parseLimit(query.limit) : 50;
      return context.json(await shareRead(analyticsReadKey('holders', context, deployment, marketId), () => readMarketHolders({ pool: pool(), deployment, marketId,
        limit, secret: cursorSecret, ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(schemaName ? { schemaName } : {}) })));
    } catch (error) { return analyticsError(context, error, 'holder'); }
  });

  app.get('/v1/markets/:marketId/detail', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['period','section']);
      if(query.section!==undefined&&!/^(activity|statistics|chart|trades|holders|fees)(,(statistics|chart|trades|holders|fees))*$/.test(query.section))throw new Error('invalid detail section');
      const period = query.period ?? '1D'; if (period !== '1H' && period !== '12H' && period !== '1D') throw new Error('invalid detail period');
      const marketId = parseMarketId(context.req.param('marketId'));
      return context.json(await shareRead(analyticsReadKey('detail', context, deployment, marketId), () => readTokenDetail({ pool: pool(), deployment, marketId, period,
        ...(query.section?{section:query.section}:{}),
        ...(schemaName ? { schemaName } : {}) })));
    } catch (error) { return analyticsError(context, error, 'candle'); }
  });

  app.get('/v1/prices/references', async (context) => {
    try { rejectUnknown(context.req.query(), []); return context.json(await readDisplayPrices({ pool: pool(), deployment, ...(schemaName ? { schemaName } : {}) })); }
    catch (error) { return analyticsError(context, error, 'candle'); }
  });

  app.get('/v1/statistics-prices', async (context) => {
    try { rejectUnknown(context.req.query(), []); return context.json(await readStatisticsPrices({ pool: pool(), deployment, ...(schemaName ? { schemaName } : {}) })); }
    catch (error) { return analyticsError(context, error, 'candle'); }
  });

  app.get('/v1/market-statistics', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['markets']);
      if (!query.markets) throw new Error('invalid markets: request 1 to 100 explicit market IDs');
      const marketIds = parseMarketIds(query.markets);
      return context.json(await shareRead('market-statistics:'+JSON.stringify(marketIds),()=>readMarketStatistics({ pool: pool(), deployment, marketIds, ...(schemaName ? { schemaName } : {}) })));
    } catch (error) { return analyticsError(context, error, 'candle'); }
  });

  app.get('/v1/market-display-statistics', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['marketId']); if (!query.marketId) throw new Error('invalid marketId');
      return context.json(await shareRead('market-display-statistics:'+parseMarketId(query.marketId),()=>readMarketDisplayStatistics({ pool: pool(), deployment, marketId: parseMarketId(query.marketId!), ...(schemaName ? { schemaName } : {}) })));
    } catch (error) { return analyticsError(context, error, 'candle'); }
  });

  app.get('/v1/stats/holders', async (context) => {
    try { rejectUnknown(context.req.query(), []); return context.json(await cachedGlobalRead('holders',readPool=>readGlobalHolders({pool:readPool,deployment,...(schemaName?{schemaName}:{})}))); }
    catch(error){return analyticsError(context,error,'holder');}
  });

  app.get('/v1/stats/overview', async (context) => {
    try { const query=context.req.query();rejectUnknown(query,['from','to']);if(query.from===undefined||query.to===undefined)throw new Error('invalid statistics window');
      const from=parseTimestamp(query.from!),to=parseTimestamp(query.to!);if(from>=to)throw Error('invalid statistics window');return context.json(await cachedGlobalRead('overview:'+JSON.stringify([from,to]),readPool=>readGlobalStatistics({pool:readPool,deployment,from,to,...(schemaName?{schemaName}:{})}))); }
    catch(error){return analyticsError(context,error,'candle');}
  });

  app.get('/v1/stats/series', async (context) => {
    try { const query=context.req.query();rejectUnknown(query,['interval','from','to']);if(query.interval===undefined||query.from===undefined||query.to===undefined)throw new Error('invalid series query');
      const interval=parseInterval(query.interval!),from=parseTimestamp(query.from!),to=parseTimestamp(query.to!);if(from>=to||from%interval||to%interval||(to-from)/interval>2000)throw Error('invalid series interval');return context.json(await cachedGlobalRead('series:'+JSON.stringify([interval,from,to]),readPool=>readGlobalSeries({pool:readPool,deployment,interval,from,to,...(schemaName?{schemaName}:{})}))); }
    catch(error){return analyticsError(context,error,'candle');}
  });

  app.get('/v1/stats/display',async context=>{try{rejectUnknown(context.req.query(),['section']);const section=context.req.query('section');return context.json(await shareGlobalRead('stats-display:'+String(section),()=>readStatsDisplay({pool:pool(),deployment,...(schemaName?{schemaName}:{})},section)));}catch(error){return analyticsError(context,error,'candle');}});
  app.get('/v1/stats/events',context=>marketEvents(context,'@stats'));

  app.get('/v1/protocol-statistics', async (context) => {
    try { rejectUnknown(context.req.query(),[]);return context.json(await shareGlobalRead('protocol',()=>readProtocolStatistics({pool:pool(),deployment,...(schemaName?{schemaName}:{})}))); }
    catch(error){return analyticsError(context,error,'candle');}
  });

  return app;
}

async function readError(context: Context, error: unknown, deployment: DeploymentIdentity) {
  if (error instanceof PublicationChangedError) return context.json({ error: 'invalid_request', message: error.message, sync: await unavailableSync(deployment) }, 409);
  if (error instanceof PublicationUnavailableError) return context.json({ error: 'identity_unavailable', message: 'A complete finalized publication is not available', sync: await unavailableSync(deployment) }, 503);
  if (error instanceof Error && /invalid|limit|cursor|sort|query|creation time|search/.test(error.message)) {
    return context.json({ error: 'invalid_request', message: error.message, sync: await unavailableSync(deployment) }, 400);
  }
  throw error;
}
async function analyticsError(context: Context, error: unknown, kind: 'trade' | 'candle' | 'holder') {
  if (error instanceof PublicationChangedError) return context.json({ error: `${kind}_page_changed`, message: error.message, requestId: context.get('requestId') }, 409);
  if (error instanceof PublicationUnavailableError) return context.json({ error: 'analytics_unavailable', message: error.message, requestId: context.get('requestId') }, 503);
  if (error instanceof Error && /invalid|limit|cursor|window|interval|query/.test(error.message)) return context.json({ error: 'invalid_query', message: error.message, requestId: context.get('requestId') }, 400);
  throw error;
}
async function accountError(context: Context, error: unknown, deployment: DeploymentIdentity) {
  if (error instanceof PublicationChangedError) return context.json({ error: 'invalid_request', message: error.message, sync: await unavailableSync(deployment) }, 409);
  if (error instanceof PublicationUnavailableError) return context.json({ error: 'accounts_unavailable', message: 'A complete finalized account publication is not available', sync: await unavailableSync(deployment) }, 503);
  if (error instanceof Error && /invalid|limit|cursor|address/.test(error.message)) return context.json({ error: 'invalid_request', message: error.message, sync: await unavailableSync(deployment) }, 400);
  throw error;
}
async function historyError(context: Context, error: unknown) {
  if (error instanceof PublicationChangedError) return context.json({ error: 'history_page_changed', message: error.message }, 409);
  if (error instanceof PublicationUnavailableError) return context.json({ error: 'history_unavailable', message: error.message }, 503);
  if (error instanceof Error && /invalid|limit|cursor|query|address|account/.test(error.message)) return context.json({ error: 'invalid_request', message: error.message }, 400);
  throw error;
}
async function transactionError(context: Context, error: unknown) {
  if (error instanceof PublicationUnavailableError) return context.json({ error: 'transaction_unavailable', message: error.message, requestId: context.get('requestId') }, 503);
  if (error instanceof Error && /invalid/.test(error.message)) return context.json({ error: 'invalid_query', message: error.message, requestId: context.get('requestId') }, 400);
  return context.json({ error: 'transaction_unavailable', message: 'transaction observations are unavailable or inconsistent', requestId: context.get('requestId') }, 503);
}

function rejectUnknown(query: Record<string, string>, allowed: readonly string[]): void {
  for (const key of Object.keys(query)) if (!allowed.includes(key)) throw new Error(`invalid query parameter: ${key}`);
}
export function analyticsReadKey(kind: string, context: Pick<Context, 'req'>, deployment: DeploymentIdentity, marketId: string): string {
  const query = context.req.query();
  const orderedQuery = Object.keys(query).sort().map(key => [key, query[key]]);
  // Keep identity in the key even when the current route is public: deployments may
  // add authenticated views later, and a request must never join another user's read.
  const identity = createHash('sha256').update([context.req.header('authorization') ?? '', context.req.header('x-user-address') ?? ''].join('\0')).digest('hex');
  return `analytics:${kind}:${JSON.stringify({ deployment: [deployment.environment, deployment.chainId, deployment.deploymentDigest, String(deployment.activationBlock)], marketId, query: orderedQuery, identity })}`;
}
function parsePhase(value: string): 0 | 1 { if (value === '0') return 0; if (value === '1') return 1; throw new Error('invalid launchPhase'); }
function parseLimit(value: string): number { if (!/^[1-9][0-9]*$/.test(value)) throw new Error('invalid limit'); const result = Number(value); if (!Number.isSafeInteger(result) || result > 100) throw new Error('invalid limit'); return result; }
function parseSort(value: string): NonNullable<MarketPageFilter['sort']> {
  const values: NonNullable<MarketPageFilter['sort']>[] = ['marketId_asc', 'marketId_desc', 'createdAt_asc', 'createdAt_desc', 'name_asc', 'launchPhase_asc', 'volume24hUsd_desc', 'marketCapUsd_desc', 'recentBuy_desc'];
  if (!values.includes(value as never)) throw new Error('invalid sort');
  return value as NonNullable<MarketPageFilter['sort']>;
}
function parseConfigKind(value: string): 'asset' | 'quote' | 'baseline' | 'template' {
  if (value !== 'asset' && value !== 'quote' && value !== 'baseline' && value !== 'template') throw new Error('invalid config kind');
  return value;
}
function parseMarketId(value: string): `0x${string}` { const result = value.toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(result)) throw new Error('invalid marketId'); return result as `0x${string}`; }
function parseAddress(value: string): `0x${string}` { const result = value.toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(result)) throw new Error('invalid address'); return result as `0x${string}`; }
function parseMarketIds(value: string): `0x${string}`[] { if (!value) return []; const ids = value.split(',').map(parseMarketId); if (ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('invalid markets'); return ids; }
function parseTimestamp(value: string): number { if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('invalid timestamp'); const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error('invalid timestamp'); return result; }
function parseBlock(value: string): bigint { if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('invalid block'); return BigInt(value); }
function parseInterval(value: string): 60 | 300 | 900 | 3600 | 14400 | 86400 {
  const intervals = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 } as const;
  const result = intervals[value as keyof typeof intervals]; if (!result) throw new Error('invalid interval'); return result;
}
function environmentName(value: string | undefined): 'preview' | 'test' | 'production' { return value === 'preview' || value === 'production' ? value : 'test'; }

export default createReadApiApp();

function parseIncludeRecent(value:string|undefined):boolean{if(value===undefined||value==='false')return false;if(value==='true')return true;throw Error('invalid includeRecent');}
