import {readConfirmedDetail} from '../../confirmed-display/src/read.ts';
import type {TokenDetailResponse} from '../../../openapi/generated/v1-client.ts';
import { coverageFor } from '../../statistics-store/src/index.ts';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { DeploymentIdentity } from '../../chain/src/index.ts';
import { transaction } from '../../db/src/index.ts';
import { buildCandles, type Address, type CandleSeries, type TradeActivity } from '../../analytics/src/index.ts';
import { decodeCursor, encodeCursor, PublicationChangedError, PublicationUnavailableError } from '../../read-store/src/index.ts';

type Hex32 = `0x${string}`;
interface MarketIdentity { readonly marketId: Hex32; readonly memeToken: Address; readonly quoteAsset: Address; readonly quoteAssetConfigId: Hex32; readonly source: { readonly blockNumber: string } }
export interface RangeCoverage { readonly from: number; readonly to: number; readonly anchorNumber: number; readonly anchorHash: Hex32; readonly throughNumber: number; readonly throughHash: Hex32; readonly projectionNumber: number; readonly projectionHash: Hex32 }

export async function readMarketTrades(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly marketId: Hex32;
  readonly from: number; readonly to: number; readonly limit: number; readonly secret: string; readonly cursor?: string; readonly schemaName?: string }) {
  validateWindow(input.from, input.to); validateLimit(input.limit);
  return transaction(input.pool, async (client) => {
    const context = await analyticsContext(client, input.deployment, input.marketId, input.from, input.to, input.schemaName);
    const revision = sha256(`${context.revision}:trades:${input.marketId}:${input.from}:${input.to}`);
    const filterDigest = sha256(`${input.marketId}:${input.from}:${input.to}:${input.limit}`);
    const after = input.cursor ? decodeCursor(input.cursor, { scope: 'market-trades', revision, filterDigest }, input.secret) : undefined;
    const [blockNumber, transactionIndex, logIndex] = after?.sortKey.split(':') ?? [];
    if (after && (!blockNumber || transactionIndex === undefined || logIndex === undefined || !/^\d+$/.test(blockNumber + transactionIndex + logIndex))) throw new PublicationChangedError('trade cursor is invalid');
    const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
    const rows = await client.query<{ payload: TradeActivity; block_number: string; transaction_index: string; log_index: string }>(
      `SELECT t.payload,b.number AS block_number,(t.payload->'source'->>'transactionIndex')::bigint AS transaction_index,t.log_index
       FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash
       WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized
         AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6)
         AND ($7::bigint IS NULL OR (b.number,(t.payload->'source'->>'transactionIndex')::bigint,t.log_index)<($7,$8,$9))
       ORDER BY b.number DESC,transaction_index DESC,t.log_index DESC LIMIT $10`,
      [...identity(input.deployment), input.marketId, input.from, input.to, blockNumber ?? null, transactionIndex ?? null, logIndex ?? null, input.limit + 1],
    );
    const visible = rows.rows.slice(0, input.limit); const last = visible.at(-1);
    const nextCursor = rows.rows.length > input.limit && last ? encodeCursor({ scope: 'market-trades', revision, filterDigest,
      sortKey: `${last.block_number}:${last.transaction_index}:${last.log_index}`, identity: last.payload.source.eventKey }, input.secret) : null;
    return { chainId: input.deployment.chainId, displayOnly: true as const, marketId: input.marketId, memeAsset: context.market.memeToken,
      quoteAsset: context.market.quoteAsset, quoteDecimals: context.quoteDecimals, coverage: context.coverage, revision,
      items: visible.map((row) => row.payload), nextCursor };
  });
}

export async function readMarketCandles(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly marketId: Hex32;
  readonly from: number; readonly to: number; readonly interval: 60 | 300 | 900 | 3600 | 14400 | 86400; readonly schemaName?: string }) {
  validateWindow(input.from, input.to);
  if (input.from % input.interval || input.to % input.interval || (input.to - input.from) / input.interval > 2_000) throw new Error('invalid candle interval or window');
  return transaction(input.pool, async (client) => {
    const context = await analyticsContext(client, input.deployment, input.marketId, input.from, input.to, input.schemaName);
    const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
    const rows = await client.query<{ payload: TradeActivity }>(
      `SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash
       WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized
       AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6)
       ORDER BY b.number,(t.payload->'source'->>'transactionIndex')::bigint,t.log_index LIMIT 100001`,
      [...identity(input.deployment), input.marketId, input.from, input.to],
    );
    if (rows.rows.length > 100_000) throw new PublicationUnavailableError('candle trade input exceeds bound');
    const series: CandleSeries = buildCandles({ chainId: input.deployment.chainId, marketId: input.marketId,
      memeAsset: context.market.memeToken, quoteAsset: context.market.quoteAsset, quoteDecimals: context.quoteDecimals,
      from: input.from, to: input.to, interval: input.interval, trades: rows.rows.map((row) => row.payload) });
    return { chainId: input.deployment.chainId, displayOnly: true as const, marketId: input.marketId, memeAsset: context.market.memeToken,
      quoteAsset: context.market.quoteAsset, quoteDecimals: context.quoteDecimals, interval: input.interval, coverage: context.coverage, series };
  });
}

export async function readMarketHolders(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly marketId: Hex32;
  readonly limit: number; readonly secret: string; readonly cursor?: string; readonly schemaName?: string }) {
  validateLimit(input.limit);
  return transaction(input.pool, async (client) => {
    const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
    const checkpoint = await checkpointContext(client, schema, input.deployment);
    const market = await marketAt(client, schema, input.deployment, checkpoint.revision, input.marketId);
    const quoteDecimals = await quoteDecimalsAt(client, schema, input.deployment, checkpoint.revision, market.quoteAssetConfigId); void quoteDecimals;
    const metadata = await client.query<{ total_supply_raw: string; positive_address_count: string; included_address_count: string; excluded_accounts: Address[]; creation_block: string }>(
      `SELECT h.total_supply_raw::text,h.positive_address_count::text,h.included_address_count::text,h.excluded_accounts,h.creation_block::text FROM ${schema}.holder_snapshots_covered h
       JOIN ${schema}.chain_blocks b ON b.environment=h.environment AND b.chain_id=h.chain_id AND b.deployment_digest=h.deployment_digest AND b.hash=h.block_hash
       WHERE h.environment=$1 AND h.chain_id=$2 AND h.deployment_digest=$3 AND h.market_id=$4 AND h.block_hash=$5 AND h.block_number=$6 AND b.canonical AND b.finalized`,
      [...identity(input.deployment), input.marketId, checkpoint.blockHash, checkpoint.blockNumber.toString()],
    );
    const meta = metadata.rows[0];
    if (!meta) throw new PublicationUnavailableError('holder snapshot is unavailable');
    const revision = sha256(`${checkpoint.revision}:holders:${input.marketId}`);
    const filterDigest = sha256(`${input.marketId}:${input.limit}`);
    const after = input.cursor ? decodeCursor(input.cursor, { scope: 'market-holders', revision, filterDigest }, input.secret) : undefined;
    const rows = await client.query<{ account: Address; balance_raw: string; excluded: boolean }>(
      `SELECT account,balance_raw::text,excluded FROM ${schema}.holder_balances
       WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4
       AND ($5::text IS NULL OR account>$5) ORDER BY account LIMIT $6`,
      [...identity(input.deployment), input.marketId, after?.identity ?? null, input.limit + 1],
    );
    const visible = rows.rows.slice(0, input.limit); const last = visible.at(-1);
    const nextCursor = rows.rows.length > input.limit && last ? encodeCursor({ scope: 'market-holders', revision, filterDigest,
      sortKey: last.account, identity: last.account }, input.secret) : null;
    return { chainId: input.deployment.chainId, displayOnly: true as const, marketId: input.marketId, memeToken: market.memeToken,
      creationBlockNumber: meta.creation_block, sourceBlockNumber: checkpoint.blockNumber.toString(), sourceBlockHash: checkpoint.blockHash,
      finality: 'finalized' as const, exclusionPolicy: 'KNOWN_PROTOCOL_ADDRESSES_V1' as const, totalSupplyRaw: meta.total_supply_raw,
      positiveAddressCount: safeInteger(meta.positive_address_count, 'positive holder count'), includedAddressCount: safeInteger(meta.included_address_count, 'included holder count'), excludedAccounts: meta.excluded_accounts,
      balances: visible.map((row) => ({ account: row.account, balanceRaw: row.balance_raw, excluded: row.excluded })), revision, nextCursor };
  });
}

export async function readTokenDetail(input: { readonly pool: Pool; readonly deployment: DeploymentIdentity; readonly marketId: Hex32;
  readonly period: '1H' | '12H' | '1D'; readonly section?: string; readonly schemaName?: string }) {
  const periodConfig = { '1H': [3_600, 60], '12H': [43_200, 300], '1D': [86_400, 900] } as const;
  const [duration, interval] = periodConfig[input.period];
  const selected=new Set(input.section==='activity'?['trades','fees']:input.section?.split(',')??['statistics','chart','trades','holders','fees']);
  const select=(value:TokenDetailResponse):TokenDetailResponse=>({...value,statistics:selected.has('statistics')?value.statistics:null,chart:selected.has('chart')?value.chart:null,trades:selected.has('trades')?value.trades?.slice(0,30)??null:null,holders:selected.has('holders')?value.holders:null,fees:selected.has('fees')?value.fees:null,sources:Object.fromEntries(Object.entries(value.sources).filter(([k])=>selected.has(k)))});
  return transaction(input.pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const schema = identifier(input.schemaName ?? 'tickergarden_serverless');
    const confirmed=await readConfirmedDetail(client,input.deployment,input.marketId,input.period,input.schemaName,input.section);if(confirmed)return confirmed;
    const recent=await client.query<{initial_detail:TokenDetailResponse}>(`SELECT initial_detail FROM ${schema}.recent_markets
      WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND canonical AND expires_at>now() AND initial_detail IS NOT NULL
      AND block_number>coalesce((SELECT next_block-1 FROM ${schema}.projection_checkpoints WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='analytics'),-1)`,[...identity(input.deployment),input.marketId]);
    if(recent.rows[0]){
      const initial=recent.rows[0].initial_detail,source=initial.sources.trades;
      if(selected.has('chart')&&source&&initial.trades){
        const to=(Math.floor(source.asOf/interval)+1)*interval,from=to-duration;
        const points:Array<{timestamp:number;price:string|null}>=Array.from({length:duration/interval},(_,i)=>({timestamp:from+i*interval,price:null}));
        for(const trade of [...initial.trades].reverse()){if(trade.timestamp<from||trade.timestamp>source.asOf)continue;const point=points[Math.floor((trade.timestamp-from)/interval)];if(point)point.price=trade.price;}
        return select({...initial,period:input.period,chart:{from,to,interval,points},sources:{...initial.sources,chart:source},reasons:{...initial.reasons,chart:''}});
      }
      return select({...initial,period:input.period});
    }
    const checkpoint = await checkpointContext(client, schema, input.deployment);
    const market = await marketAt(client, schema, input.deployment, checkpoint.revision, input.marketId);
    const quoteDecimals = await quoteDecimalsAt(client, schema, input.deployment, checkpoint.revision, market.quoteAssetConfigId);
    const to = Math.floor(checkpoint.asOf / interval) * interval; const from = to - duration;
    const source = { provider: 'indexer' as const, asOf: checkpoint.asOf, blockNumber: checkpoint.blockNumber.toString(), blockHash: checkpoint.blockHash };
    if(input.section==='activity') {
      const history=await client.query<{payload:TradeActivity}>(
        `SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash
         WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized AND b.number<=$5
         ORDER BY b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC LIMIT 30`,
        [...identity(input.deployment),input.marketId,checkpoint.blockNumber.toString()]);
      const totals=await client.query<{recipient:'creator'|'stakers'|'platform'|'holders';asset:Address;amountRaw:string}>(
        `SELECT recipient,asset,amount_raw::text AS "amountRaw" FROM ${schema}.detail_fee_totals
         WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 ORDER BY recipient,asset`,[...identity(input.deployment),input.marketId]);
      return {version:1 as const,chainId:input.deployment.chainId,displayOnly:true as const,marketId:input.marketId,
        memeToken:market.memeToken,quoteAsset:market.quoteAsset,quoteDecimals,period:input.period,
        statistics:null,chart:null,holders:null,
        trades:history.rows.map(({payload:t})=>({timestamp:Number(t.timestamp),side:t.side,price:rationalDecimal(t.price),memeRaw:t.memeRaw,quoteRaw:t.quoteRaw,actor:t.actor,txHash:t.source.transactionHash,eventKey:t.source.eventKey,classification:t.classification})),
        fees:totals.rows,sources:{trades:source,fees:source},reasons:{}};
    }
    const reasons: Record<string, string> = {};
    let chart: { from: number; to: number; interval: typeof interval; points: { timestamp: number; price: string | null }[] } | null = null;
    let statistics: { price: string | null; volume24h: string | null; volumeFrom: number; volumeTo: number; volumeBasis: 'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE' } | null = null;
    let trades: { timestamp: number; side: 'buy' | 'sell'; price: string; memeRaw: string; quoteRaw: string; actor: Address | null; txHash: Hex32; eventKey: string; classification: TradeActivity['classification'] }[] | null = null;
    try {
      if(selected.has('chart')){
      await analyticsCoverage(client, schema, input.deployment, checkpoint, from, to);
      const rows = await client.query<{ payload: TradeActivity }>(
        `SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash
         WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized
         AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6)
         ORDER BY b.number,(t.payload->'source'->>'transactionIndex')::bigint,t.log_index LIMIT 100001`,
        [...identity(input.deployment), input.marketId, from, to],
      );
      if (rows.rows.length > 100_000) throw new Error('detail trade input exceeds bound');
      const values = rows.rows.map((row) => row.payload);
      const series = buildCandles({ chainId: input.deployment.chainId, marketId: input.marketId, memeAsset: market.memeToken,
        quoteAsset: market.quoteAsset, quoteDecimals, from, to, interval, trades: values });
      chart = { from, to, interval, points: series.candles.map((candle) => ({ timestamp: candle.timestamp, price: candle.close ? rationalDecimal(candle.close) : null })) };
      }
    } catch (error) {
      if (!(error instanceof PublicationUnavailableError)) throw error;
      reasons.chart = error.message;
    }
    try {
      const volumeFrom = to - 86_400;
      if(selected.has('statistics')||selected.has('trades')){
      // The chart is intentionally interval-scoped, while the detail feed and
      // headline price remain useful for quiet markets by reading the full
      // finalized history at this pinned checkpoint.
      const historyRows = await client.query<{ payload: TradeActivity }>(
        `SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash
         WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized AND b.number<=$5
         ORDER BY b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC LIMIT 30`,
        [...identity(input.deployment), input.marketId, checkpoint.blockNumber.toString()],
      );
      const historicalValues = historyRows.rows.map((row) => row.payload);
      trades = historicalValues.map((trade) => ({ timestamp: Number(trade.timestamp),
        side: trade.side, price: rationalDecimal(trade.price), memeRaw: trade.memeRaw, quoteRaw: trade.quoteRaw, actor: trade.actor,
        txHash: trade.source.transactionHash, eventKey: trade.source.eventKey, classification: trade.classification }));
      if(selected.has('statistics'))try {
        // A short-period chart can remain available before a complete 24-hour
        // volume window exists. Reuse the pinned checkpoint and identity while
        // validating the wider interval independently.
        await analyticsCoverage(client, schema, input.deployment, checkpoint, volumeFrom, to);
        const volume = await client.query<{ volume: string | null }>(
          `SELECT (sum(quote_raw)::numeric / power(10::numeric,$7))::text AS volume FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash
           WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized
           AND t.classification='unclassified' AND t.occurred_at>=to_timestamp($5) AND t.occurred_at<to_timestamp($6)`,
          [...identity(input.deployment), input.marketId, volumeFrom, to, quoteDecimals],
        );
        const latest = historicalValues[0];
        statistics = { price: latest ? rationalDecimal(latest.price) : null, volume24h: volume.rows[0]?.volume ?? '0', volumeFrom, volumeTo: to,
          volumeBasis: 'EXTERNAL_EXECUTIONS_CURVE_EXCLUDING_FEE_TAX_OR_POOL_CORE' };
      } catch (error) {
        if (!(error instanceof PublicationUnavailableError)) throw error;
        reasons.statistics = error.message;
      }
      }
    } catch (error) {
      if (!(error instanceof PublicationUnavailableError)) throw error;
      reasons.statistics ??= error.message; reasons.trades = error.message;
    }
    const detailRows = selected.has('holders')||selected.has('fees')?await client.query<{ total_supply_raw: string | null; holder_count: string; holders: { account: Address; balanceRaw: string }[]; fees: { recipient: 'creator' | 'stakers' | 'platform' | 'holders'; asset: Address; amountRaw: string }[] }>(
      `WITH included AS (
         SELECT account,balance_raw FROM ${schema}.holder_balances WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND NOT excluded
       ), top_holders AS (
         SELECT account,balance_raw FROM included ORDER BY balance_raw DESC,account LIMIT 100
       )
       SELECT
         (SELECT total_supply_raw::text FROM ${schema}.holder_snapshots_covered WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4 AND block_hash=$5 AND block_number=$6) AS total_supply_raw,
         (SELECT count(*)::text FROM included) AS holder_count,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('account',account,'balanceRaw',balance_raw::text) ORDER BY balance_raw DESC,account) FROM top_holders),'[]'::jsonb) AS holders,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('recipient',recipient,'asset',asset,'amountRaw',amount_raw::text) ORDER BY recipient,asset)
           FROM ${schema}.detail_fee_totals WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND market_id=$4),'[]'::jsonb) AS fees`,
      [...identity(input.deployment), input.marketId, checkpoint.blockHash, checkpoint.blockNumber.toString()],
    ):{rows:[]};
    const detailRow = detailRows.rows[0];
    const holderCount = safeInteger(detailRow?.holder_count ?? '0', 'holder count');
    const holders = detailRow?.total_supply_raw ? { totalSupplyRaw: detailRow.total_supply_raw, circulatingSupplyRaw: detailRow.total_supply_raw,
      count: holderCount, basis: 'CHAIN_TOTAL_SUPPLY_V1' as const,
      items: detailRow.holders } : null;
    if (!holders) reasons.holders = 'Finalized holder projection is not available';
    const fees = detailRow?.fees ?? [];
    const sources: Record<string, typeof source> = {};
    if (statistics) sources.statistics = source; if (chart) sources.chart = source; if (trades) sources.trades = source; if (holders) sources.holders = source;
    sources.fees = source;
    return select({ version: 1 as const, chainId: input.deployment.chainId, displayOnly: true as const, marketId: input.marketId,
      memeToken: market.memeToken, quoteAsset: market.quoteAsset, quoteDecimals, period: input.period, statistics, chart, trades,
      holders, fees, sources, reasons });
  });
}

async function analyticsContext(client: PoolClient, deployment: DeploymentIdentity, marketId: Hex32, from: number, to: number, schemaName?: string) {
  const schema = identifier(schemaName ?? 'tickergarden_serverless'); const checkpoint = await checkpointContext(client, schema, deployment);
  const market = await marketAt(client, schema, deployment, checkpoint.revision, marketId);
  const quoteDecimals = await quoteDecimalsAt(client, schema, deployment, checkpoint.revision, market.quoteAssetConfigId);
  const coverage = await analyticsCoverage(client, schema, deployment, checkpoint, from, to);
  return { revision: checkpoint.revision, market, quoteDecimals, coverage };
}
async function analyticsCoverage(client: PoolClient, schema: string, deployment: DeploymentIdentity, checkpoint: Awaited<ReturnType<typeof checkpointContext>>, from: number, to: number): Promise<RangeCoverage> {
  return coverageFor(client, schema, deployment, {number:checkpoint.blockNumber.toString(),hash:checkpoint.blockHash,asOf:checkpoint.asOf}, from, to);
}
async function checkpointContext(client: PoolClient, schema: string, deployment: DeploymentIdentity) {
  const row = (await client.query<{ last_revision: string; block_number: string; block_hash: Hex32; as_of: string }>(
    `SELECT c.last_revision,b.number AS block_number,b.hash AS block_hash,extract(epoch from b.source_timestamp)::bigint::text AS as_of FROM ${schema}.projection_checkpoints c
     JOIN ${schema}.chain_blocks b ON b.environment=c.environment AND b.chain_id=c.chain_id AND b.deployment_digest=c.deployment_digest AND b.number=c.next_block-1
     WHERE c.environment=$1 AND c.chain_id=$2 AND c.deployment_digest=$3 AND c.scope='analytics' AND b.canonical AND b.finalized AND c.last_revision=b.number::text||':'||b.hash`, identity(deployment))).rows[0];
  if (!row) throw new PublicationUnavailableError('analytics projection is unavailable');
  const asOf = Number(row.as_of); if (!Number.isSafeInteger(asOf) || asOf < 0) throw new PublicationUnavailableError('analytics source time is unavailable');
  return { revision: row.last_revision, blockNumber: BigInt(row.block_number), blockHash: row.block_hash, asOf };
}
async function marketAt(client: PoolClient, schema: string, deployment: DeploymentIdentity, revision: string, marketId: Hex32): Promise<MarketIdentity> {
  const row = (await client.query<{ payload: MarketIdentity }>(`SELECT payload FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='markets' AND revision=$4 AND identity=$5`, [...identity(deployment), revision, marketId])).rows[0];
  if (!row) throw new PublicationUnavailableError('market analytics identity is unavailable'); return row.payload;
}
async function quoteDecimalsAt(client: PoolClient, schema: string, deployment: DeploymentIdentity, revision: string, configId: Hex32): Promise<number> {
  const row = (await client.query<{ decimals: string }>(`SELECT payload->'values'->>'quoteDecimals' AS decimals FROM ${schema}.projection_read_records WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND scope='configs' AND revision=$4 AND identity='quote:'||$5`, [...identity(deployment), revision, configId])).rows[0];
  const value = Number(row?.decimals); if (!Number.isSafeInteger(value) || value < 6 || value > 18) throw new PublicationUnavailableError('quote decimals are unavailable'); return value;
}
function validateWindow(from: number, to: number): void { if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from) throw new Error('invalid analytics window') }
function validateLimit(limit: number): void { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100') }
function safeInteger(value: string, label: string): number { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new PublicationUnavailableError(`${label} exceeds supported range`); return parsed }
function sha256(value: string): string { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function rationalDecimal(value: { readonly numerator: string; readonly denominator: string }): string { const numerator = BigInt(value.numerator); const denominator = BigInt(value.denominator); if (numerator <= 0n || denominator <= 0n) throw new Error('invalid rational price'); const scale = 10n ** 36n; const scaled = numerator * scale / denominator; return `${scaled / scale}.${(scaled % scale).toString().padStart(36, '0')}`; }
function compareTradeDescending(left: TradeActivity, right: TradeActivity): number { const block = BigInt(right.source.blockNumber) - BigInt(left.source.blockNumber); if (block) return block < 0n ? -1 : 1; return right.source.transactionIndex - left.source.transactionIndex || right.source.logIndex - left.source.logIndex; }
function identity(deployment: DeploymentIdentity): [string, number, string] { return [deployment.environment, deployment.chainId, deployment.deploymentDigest] }
function identifier(value: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid database schema name'); return `"${value}"` }
