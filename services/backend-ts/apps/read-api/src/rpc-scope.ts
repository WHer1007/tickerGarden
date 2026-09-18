import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../../packages/chain/src/index.ts';
import {fixedF72Sources,eventTopicsForModules} from '../../../packages/events/src/index.ts';
import {runtimeConfigs} from '../../../packages/runtime-deployment/src/index.ts';
import {externalTradingService} from '../../../packages/chain/src/external-trading.ts';
import {routes} from '../../../packages/chain/src/quote-purchase/routes.ts';
import {WETH,USDG,Q3,Q4,bridge} from '../../../packages/chain/src/quote-purchase/quote.ts';
import {ALLOWANCE_HOLDER,SETTLER_REGISTRY} from '../../../packages/chain/src/quote-purchase/zeroex.ts';
const address=/^0x[0-9a-f]{40}$/;
// ERC-20 Transfer and Approval signatures.
const tokenTopics=['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'];
export interface RpcTarget {address:string;topics:readonly string[];poolIds?:readonly string[]}
export async function rpcScope(pool:Pool,d:DeploymentIdentity,requested:string[],schemaName='tickergarden_serverless'):Promise<RpcTarget[]>{
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName))throw Error('Invalid schema');
 const schema=`"${schemaName}"`,scope=new Map<string,RpcTarget>();
 for(const s of fixedF72Sources())scope.set(s.address,{address:s.address,topics:s.module==='UniswapV4PoolManager'?[]:eventTopicsForModules([s.module])});
 for(const config of runtimeConfigs)for(const key of ['stockToken','quoteAsset','userStockVault']){
  const value=config.values[key];if(typeof value==='string'&&address.test(value)&&!/^0x0{40}$/.test(value)&&!scope.has(value))scope.set(value,{address:value,topics:tokenTopics});
 }
 const service=externalTradingService(d.chainId);if(service)for(const v of [service.router,service.quoter,'0x000000000022d473030f116ddee9f6b43ac78ba3'])scope.set(v,{address:v,topics:[]});
 if(d.chainId===4663){
  for(const v of [WETH,USDG])scope.set(v,{address:v,topics:tokenTopics});
  for(const v of [Q3,Q4,bridge.pool,ALLOWANCE_HOLDER,SETTLER_REGISTRY,'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',...Object.values(routes).filter(r=>r.version==='v3').map(r=>r.pool)])scope.set(v,{address:v,topics:[]});
 }
 const missing=requested.filter(a=>!scope.has(a));
 if(missing.length){
  const rows=await pool.query<{address:string;module:string}>(`SELECT address,module FROM ${schema}.contract_sources WHERE environment=$1 AND chain_id=$2 AND deployment_digest=$3 AND active AND address=ANY($4::text[])
   UNION SELECT v.address,v.module FROM ${schema}.confirmed_display_markets m CROSS JOIN LATERAL (VALUES(m.payload->'market'->>'memeToken','TickerMemeTokenV1'),(m.payload->'market'->>'curve','TickerGardenCurve'),(m.payload->'market'->>'gauge','MemeStockGauge')) v(address,module) WHERE m.environment=$1 AND m.chain_id=$2 AND m.deployment_digest=$3 AND v.address=ANY($4::text[])
   UNION SELECT v.address,v.module FROM ${schema}.recent_markets m CROSS JOIN LATERAL (VALUES(m.payload->>'memeToken','TickerMemeTokenV1'),(m.payload->>'curve','TickerGardenCurve'),(m.payload->>'gauge','MemeStockGauge')) v(address,module) WHERE m.environment=$1 AND m.chain_id=$2 AND m.deployment_digest=$3 AND m.canonical AND v.address=ANY($4::text[])`,[d.environment,d.chainId,d.deploymentDigest,missing]);
  for(const row of rows.rows)if(address.test(row.address)&&!/^0x0{40}$/.test(row.address))scope.set(row.address,{address:row.address,topics:eventTopicsForModules([row.module])});
 }
 return requested.flatMap(a=>{const target=scope.get(a);return target?[target]:[];});
}
