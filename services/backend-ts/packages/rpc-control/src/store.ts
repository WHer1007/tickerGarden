import {coversTopics,filterScan,type ScanFilter,type ScanRecord} from './scan.ts';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
export type RpcTier='interactive'|'realtime'|'background';
export type RpcBudget={rps:number;burst:number;interactiveReserve:number;backgroundConcurrency:number;nonInteractiveConcurrency:number};
export class RpcBudgetBusy extends Error { override readonly name='RpcBudgetBusy'; constructor(){super('RPC capacity is busy; retry shortly');} }
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier=(name:string)=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw Error('Invalid RPC schema');return `"${name}"`;};
export class RpcControlStore {
 readonly pool:()=>Pool; readonly schema:string;
 constructor(pool:()=>Pool,schema='tickergarden_serverless'){this.pool=pool;this.schema=identifier(schema);}
 async acquire(scope:string,tier:RpcTier,budget:RpcBudget):Promise<{id:string;release:()=>Promise<void>}>{
  const c=await this.pool().connect(),s=this.schema,id=randomUUID();
  try{
   await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='500ms'");await c.query("SET LOCAL statement_timeout='1500ms'");
   await c.query(`INSERT INTO ${s}.rpc_budgets VALUES($1,$2,clock_timestamp(),$3) ON CONFLICT DO NOTHING`,[scope,budget.burst,digest([budget.rps,budget.burst,budget.interactiveReserve,budget.backgroundConcurrency,budget.nonInteractiveConcurrency])]);
   const row=(await c.query<{tokens:number;elapsed:number;policy_hash:string}>(`SELECT tokens,policy_hash,greatest(0,extract(epoch FROM clock_timestamp()-updated_at))::float8 elapsed FROM ${s}.rpc_budgets WHERE scope=$1 FOR UPDATE`,[scope])).rows[0]!;
   if(row.policy_hash!==digest([budget.rps,budget.burst,budget.interactiveReserve,budget.backgroundConcurrency,budget.nonInteractiveConcurrency]))throw Error('RPC budget policy mismatch');
   await c.query(`DELETE FROM ${s}.rpc_leases WHERE scope=$1 AND expires_at<=clock_timestamp()`,[scope]);
   const n=(await c.query<{background:number;other:number}>(`SELECT count(*) FILTER(WHERE tier='background')::int background,count(*) FILTER(WHERE tier<>'interactive')::int other FROM ${s}.rpc_leases WHERE scope=$1`,[scope])).rows[0]!;
   const tokens=Math.min(budget.burst,row.tokens+row.elapsed*budget.rps),reserve=tier==='interactive'?0:budget.interactiveReserve;
   if(tokens<1+reserve||(tier==='background'&&n.background>=budget.backgroundConcurrency)||(tier!=='interactive'&&n.other>=budget.nonInteractiveConcurrency))throw new RpcBudgetBusy();
   await c.query(`UPDATE ${s}.rpc_budgets SET tokens=$2,updated_at=clock_timestamp() WHERE scope=$1`,[scope,tokens-1]);
   await c.query(`INSERT INTO ${s}.rpc_leases VALUES($1,$2,$3,clock_timestamp()+interval '30 seconds')`,[id,scope,tier]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  return {id,release:()=>this.release(id)};
 }
 async release(id:string){await this.pool().query(`DELETE FROM ${this.schema}.rpc_leases WHERE id=$1`,[id]);}
 async get(scope:string,key:string):Promise<unknown|undefined>{
  return (await this.pool().query(`SELECT payload FROM ${this.schema}.rpc_read_cache WHERE scope=$1 AND key=$2 AND expires_at>clock_timestamp()`,[scope,key])).rows[0]?.payload;
 }
 async put(scope:string,key:string,payload:unknown,ttlMs:number){
  if(payload===null||payload===undefined||Buffer.byteLength(JSON.stringify(payload))>2*1024*1024)return;
  await this.pool().query(`INSERT INTO ${this.schema}.rpc_read_cache VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 millisecond') ON CONFLICT(scope,key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`,[scope,key,JSON.stringify(payload),ttlMs]);
 }
 async share<T>(scope:string,key:string,run:()=>Promise<T>,ttl:number):Promise<{value:T;reused:boolean}>{
  const id=randomUUID(),deadline=Date.now()+1200;
  do{
   const cached=await this.get(scope,key);if(cached!==undefined)return {value:cached as T,reused:true};
   const lock=await this.pool().query(`INSERT INTO ${this.schema}.rpc_read_locks VALUES($1,$2,$3,clock_timestamp()+interval '20 seconds') ON CONFLICT(scope,key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE ${this.schema}.rpc_read_locks.expires_at<clock_timestamp() RETURNING owner`,[scope,key,id]);
   if(lock.rowCount){try{const completed=await this.get(scope,key);if(completed!==undefined)return {value:completed as T,reused:true};const value=await run();await this.put(scope,key,value,ttl);return {value,reused:false};}finally{await this.pool().query(`DELETE FROM ${this.schema}.rpc_read_locks WHERE scope=$1 AND key=$2 AND owner=$3`,[scope,key,id]);}}
   await new Promise(resolve=>setTimeout(resolve,40));
  }while(Date.now()<deadline);
  throw new RpcBudgetBusy();
 }
 async findScan(scope:string,f:ScanFilter):Promise<ScanRecord|undefined>{
  const rows=(await this.pool().query<ScanRecord>(`SELECT from_block::text,to_block::text,block_hash,addresses,topics,payload FROM ${this.schema}.rpc_scan_cache WHERE scope=$1 AND from_block<=$2 AND to_block>=$3 AND addresses && $4::text[] AND expires_at>clock_timestamp() ORDER BY to_block ASC LIMIT 64`,[scope,f.from.toString(),f.to.toString(),f.addresses])).rows;
  const matching=rows.filter(r=>coversTopics(r.topics,f.topics));
  for(const anchor of matching){
   const group=matching.filter(r=>r.to_block===anchor.to_block&&r.block_hash===anchor.block_hash);
   const addresses=new Set(group.flatMap(r=>r.addresses));
   if(f.addresses.every(a=>addresses.has(a))){
    const unique=new Map<string,Record<string,unknown>>();for(const log of filterScan(group.flatMap(r=>r.payload),f))unique.set(`${log.blockHash}:${log.transactionHash}:${log.logIndex}`,log);
    return {...anchor,from_block:f.from.toString(),addresses:f.addresses,topics:f.topics,payload:[...unique.values()]};
   }
  }
  return undefined;
 }
 async saveScan(scope:string,f:ScanFilter,hash:string,payload:Record<string,unknown>[]){
  if(Buffer.byteLength(JSON.stringify(payload))>2*1024*1024)return;
  const key=digest([f.from.toString(),f.to.toString(),f.addresses,f.topics]);
  await this.pool().query(`INSERT INTO ${this.schema}.rpc_scan_cache VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '10 minutes') ON CONFLICT(scope,key) DO UPDATE SET block_hash=excluded.block_hash,payload=excluded.payload,expires_at=excluded.expires_at`,[scope,key,f.from.toString(),f.to.toString(),hash,f.addresses,JSON.stringify(f.topics),JSON.stringify(payload)]);
 }
 async prune(){
  // Bounded cleanup, independent of financial history retention.
  for(const table of ['rpc_read_cache','rpc_scan_cache','rpc_leases','rpc_read_locks'])await this.pool().query(`DELETE FROM ${this.schema}.${table} WHERE ctid IN(SELECT ctid FROM ${this.schema}.${table} WHERE expires_at<clock_timestamp() LIMIT 1000)`);
 }
}
