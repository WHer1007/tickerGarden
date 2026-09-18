import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import type {TradeActivity} from '../../analytics/src/index.ts';
import type {TokenDetailTrade} from '../../../openapi/generated/v1-client.ts';
import type {DisplayState} from './state.ts';
import {formatUnits} from 'viem';
import {displaySchema,displayIdentity} from './worker.ts';
export async function hydrateDisplayHistory(client:Pick<Pool,'query'>,d:DeploymentIdentity,state:DisplayState,schemaName?:string){
 const schema=displaySchema(schemaName),id=displayIdentity(d);
  // Upgrade existing state once and retain the last execution independently of
  // the rolling 24h buffer. This database lookup never runs in an HTTP request.
  if(state.latestTrade===undefined){
   const latest=state.trades[0]??null;
   if(latest)state={...state,latestTrade:latest};
   else{
    const trade=(await client.query<{payload:TradeActivity}>(`SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized AND b.number<=$5 ORDER BY t.occurred_at DESC,b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC LIMIT 1`,[...id,state.market.marketId,state.blockNumber])).rows[0]?.payload;
    state={...state,latestTrade:trade?displayTrade(trade):null};
   }
  }
  if(state.latestBuy===undefined){
   const buy=(await client.query<{payload:TradeActivity}>(`SELECT t.payload FROM ${schema}.market_trades t JOIN ${schema}.chain_blocks b ON b.environment=t.environment AND b.chain_id=t.chain_id AND b.deployment_digest=t.deployment_digest AND b.hash=t.block_hash WHERE t.environment=$1 AND t.chain_id=$2 AND t.deployment_digest=$3 AND t.market_id=$4 AND b.canonical AND b.finalized AND b.number<=$5 AND t.payload->>'side'='buy' AND t.classification='unclassified' AND t.base_raw>0 AND t.quote_raw>0 ORDER BY b.number DESC,(t.payload->'source'->>'transactionIndex')::bigint DESC,t.log_index DESC LIMIT 1`,[...id,state.market.marketId,state.blockNumber])).rows[0]?.payload;
   state={...state,latestBuy:buy?{blockNumber:buy.source.blockNumber,transactionIndex:String(buy.source.transactionIndex),logIndex:String(buy.source.logIndex),timestamp:buy.timestamp}:null};
  }
 return state;
}
function displayTrade(t:TradeActivity):TokenDetailTrade{return {timestamp:Number(t.timestamp),side:t.side,price:formatUnits(BigInt(t.price.numerator)*10n**36n/BigInt(t.price.denominator),36),memeRaw:t.memeRaw,quoteRaw:t.quoteRaw,actor:t.actor,txHash:t.source.transactionHash,eventKey:t.source.eventKey,classification:t.classification};}
