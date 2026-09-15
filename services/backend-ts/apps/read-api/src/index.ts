import {readProtocolStatistics} from '../../../packages/statistics-store/src/snapshot.ts';
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
  const app = createServiceApp({ kind: 'read-api', env, requiredEnvironmentKeys: ['TG_READ_DATABASE_URL', 'TG_CURSOR_SECRET'] });
  const deployment: DeploymentIdentity = options.deployment ?? {
    environment: environmentName(env.TG_ENVIRONMENT), chainId: 46630, deploymentDigest: CURRENT_RELEASE_ID, activationBlock: CURRENT_ACTIVATION_BLOCK,
  };
  let ownedPool: Pool | undefined;
  const pool = () => ownedPool ??= options.pool ?? createDatabasePool(env.TG_READ_DATABASE_URL ?? '', {}, {role:'read-api',env}).pool;
  const schemaName = env.TG_DATABASE_SCHEMA;
  // Share only in-flight public version reads. Never cache finality decisions.
  const updateReads = new Map<string,Promise<unknown>>();
  const shareRead = createReadAdmission({ concurrency: 8, maxPending: 128,
    unavailable: () => new PublicationUnavailableError('Public read capacity is busy; retry shortly') });
  // Global scans share one bounded lane so competing chart/Holder scans cannot exhaust the pool.
  const shareGlobalRead = createReadAdmission({ concurrency: 1, maxPending: 8,
    unavailable: () => new PublicationUnavailableError('Global statistics capacity is busy; retry shortly') });

  const cachedGlobalRead=<T>(key:string,build:(readPool:Pool)=>Promise<T>)=>shareGlobalRead(key,()=>sharedStatistics({pool:pool(),deployment,...(schemaName?{schemaName}:{})},key,build));

  const cursorSecret = env.TG_CURSOR_SECRET ?? '';
  const primary = options.primary ?? (env.TG_RPC_URL ? new RpcTransport({ url: env.TG_RPC_URL }) : undefined);
  const secondary = options.secondary ?? (env.TG_SECONDARY_RPC_URL ? new RpcTransport({ url: env.TG_SECONDARY_RPC_URL }) : undefined);

  app.use('/v1/*', async (context, next) => {
    await next(); const path = context.req.path;
    const privateRead = path.includes('/users/') || path.includes('holder-snapshots') || path.includes('reward-history') || path.includes('/wallet-holder-markets') || path.includes('/transactions/');
    const activity = path.endsWith('/detail') && context.req.query('section')==='activity';
    const priceCatalog = path.endsWith('/prices/references') || path.endsWith('/statistics-prices');
    const revision = context.req.query('revision');
    const dynamicRanking = path==='/v1/markets'&&['marketCapUsd_desc','recentBuy_desc'].includes(context.req.query('sort')??'');
    const immutableRevision = context.res.status >= 200 && context.res.status < 300
      && typeof revision === 'string' && /^(0|[1-9][0-9]*):0x[0-9a-f]{64}$/.test(revision);
    context.header('cache-control', context.res.status < 200 || context.res.status >= 300 || privateRead || activity || context.req.query('includeRecent')==='true' || path.endsWith('/updates') || dynamicRanking
      ? 'no-store'
      : immutableRevision
        ? 'public, max-age=300, s-maxage=31536000, immutable'
        : priceCatalog
          ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=60'
        : 'public, max-age=5, s-maxage=15, stale-while-revalidate=30');
  });

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
      return context.json(await readMarketTrades({ pool: pool(), deployment, marketId, from: parseTimestamp(query.from), to: parseTimestamp(query.to),
        limit: query.limit ? parseLimit(query.limit) : 50, secret: cursorSecret, ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return analyticsError(context, error, 'trade'); }
  });

  app.get('/v1/markets/:marketId/candles', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['interval', 'from', 'to']);
      if (query.interval === undefined || query.from === undefined || query.to === undefined) throw new Error('invalid candle query');
      return context.json(await readMarketCandles({ pool: pool(), deployment, marketId: parseMarketId(context.req.param('marketId')),
        interval: parseInterval(query.interval), from: parseTimestamp(query.from), to: parseTimestamp(query.to),
        ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return analyticsError(context, error, 'candle'); }
  });

  app.get('/v1/markets/:marketId/holders', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['limit', 'cursor']);
      return context.json(await readMarketHolders({ pool: pool(), deployment, marketId: parseMarketId(context.req.param('marketId')),
        limit: query.limit ? parseLimit(query.limit) : 50, secret: cursorSecret, ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(schemaName ? { schemaName } : {}) }));
    } catch (error) { return analyticsError(context, error, 'holder'); }
  });

  app.get('/v1/markets/:marketId/detail', async (context) => {
    try {
      const query = context.req.query(); rejectUnknown(query, ['period','section']);
      if(query.section!==undefined&&query.section!=='activity')throw new Error('invalid detail section');
      const period = query.period ?? '1D'; if (period !== '1H' && period !== '12H' && period !== '1D') throw new Error('invalid detail period');
      return context.json(await readTokenDetail({ pool: pool(), deployment, marketId: parseMarketId(context.req.param('marketId')), period,
        ...(query.section==='activity'?{section:'activity' as const}:{}),
        ...(schemaName ? { schemaName } : {}) }));
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
      return context.json(await readMarketDisplayStatistics({ pool: pool(), deployment, marketId: parseMarketId(query.marketId), ...(schemaName ? { schemaName } : {}) }));
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
function parsePhase(value: string): 0 | 1 { if (value === '0') return 0; if (value === '1') return 1; throw new Error('invalid launchPhase'); }
function parseLimit(value: string): number { if (!/^[1-9][0-9]*$/.test(value)) throw new Error('invalid limit'); return Number(value); }
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
