import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {DeploymentIdentity} from '../../chain/src/index.ts';
import type {Address} from '../../analytics/src/index.ts';
import {logEvent} from '../../observability/src/index.ts';
import {latestPrices,preferredPrices} from './read.ts';
import type {PriceReference} from './index.ts';

type DB=Pick<Pool,'query'>;
export type PriceRows=ReadonlyArray<{readonly asset:Address;readonly payload:PriceReference}>;
export interface PriceSnapshot {readonly revision:string|null;readonly rows:PriceRows}
export interface PriceBatch {
 readonly now:Date;
 load(db:DB):Promise<PriceSnapshot>;
}
/** Explicit per-task snapshot: all consumers use one result and valuation time. */
export function createPriceBatch(d:DeploymentIdentity,schemaName?:string,now=new Date(),reader?:SharedPriceReader):PriceBatch{
 let pending:Promise<PriceSnapshot>|undefined;
 return {now,load(db){return pending??=reader?reader.read(db):latestPrices(db,d,now,schemaName).then(rows=>({revision:null,rows:freeze(rows)}));}};
}
export async function batchPrices(batch:PriceBatch,db:DB){const snapshot=await batch.load(db);return preferredPrices(snapshot.rows,batch.now);}
export function priceBatchChannel(d:DeploymentIdentity,schemaName='tickergarden_serverless'){
 return 'tg_prices_'+createHash('sha256').update(JSON.stringify([schemaName,d.environment,d.chainId,d.deploymentDigest])).digest('hex').slice(0,32);
}
/** One reader per service/deployment. Notifications invalidate; a 5s version check recovers missed notices. */
export class SharedPriceReader{
 private snapshot:PriceSnapshot|undefined;
 private checkedAt=0;
 private generation=0;
 private pending:{generation:number;promise:Promise<PriceSnapshot>}|undefined;
 private readonly d:DeploymentIdentity;
 private readonly schemaName:string;
 private readonly options:{checkMs?:number;clock?:()=>number};
 constructor(d:DeploymentIdentity,schemaName='tickergarden_serverless',options:{checkMs?:number;clock?:()=>number}={}){
  this.d=d;this.schemaName=schemaName;this.options=options;
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName))throw Error('invalid schema');
  if(options.checkMs!==undefined&&(!Number.isFinite(options.checkMs)||options.checkMs<0||options.checkMs>5000))throw Error('invalid price batch check interval');
 }
 invalidate(){this.generation++;this.checkedAt=0;}
 async read(db:DB):Promise<PriceSnapshot>{
  const time=(this.options.clock??(()=>performance.now()))(),generation=this.generation;
  if(this.snapshot&&this.snapshot.revision!==null&&this.checkedAt&&time-this.checkedAt<(this.options.checkMs??5000))return this.snapshot;
  if(this.pending?.generation===generation)return this.pending.promise;
  const cached=this.snapshot;
  const promise=(async()=>{
   // Revision and rows are evaluated in one SQL snapshot. Unchanged revisions
   // never execute the JSON aggregation or transfer all 196 prices again.
   const result=await db.query<{revision:string|null;rows:PriceRows|null}>(`SELECT b.revision::text,
     CASE WHEN b.revision IS NULL OR b.revision IS DISTINCT FROM $4::bigint THEN
       (SELECT coalesce(jsonb_agg(jsonb_build_object('asset',p.asset,'payload',p.payload) ORDER BY p.asset,p.source),'[]'::jsonb)
        FROM "${this.schemaName}".price_references p WHERE p.environment=$1 AND p.chain_id=$2 AND p.deployment_digest=$3)
     ELSE NULL END rows
     FROM (SELECT 1) anchor LEFT JOIN "${this.schemaName}".price_batches b ON b.environment=$1 AND b.chain_id=$2 AND b.deployment_digest=$3`,
     [this.d.environment,this.d.chainId,this.d.deploymentDigest,cached?.revision??null]);
   const row=result.rows[0];if(!row)throw Error('price batch missing');
   const snapshot=row.rows!==null?Object.freeze({revision:row.revision,rows:freeze(row.rows)}):cached;
   if(!snapshot)throw Error('price batch unavailable');
   if(this.generation===generation&&(!this.snapshot?.revision||!snapshot.revision||BigInt(snapshot.revision)>=BigInt(this.snapshot.revision))){this.snapshot=snapshot;this.checkedAt=(this.options.clock??(()=>performance.now()))();}
   logEvent('display-price','info','price_batch_read',{priceRevision:snapshot.revision??'unversioned',priceCache:row.rows===null?'unchanged':'refreshed',priceRows:snapshot.rows.length,chainId:this.d.chainId});
   return snapshot;
  })();
  this.pending={generation,promise};
  try{return await promise;}finally{if(this.pending?.promise===promise)this.pending=undefined;}
 }
}
function freeze(rows:PriceRows):PriceRows{return Object.freeze(rows.map(row=>Object.freeze({asset:row.asset,payload:Object.freeze({...row.payload})})));}
