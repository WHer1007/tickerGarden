import {createHash,timingSafeEqual} from 'node:crypto';
import type {Pool} from 'pg';
import {RpcControlStore,RpcBudgetBusy,type RpcTier} from '../../../packages/rpc-control/src/store.ts';
import {readBudgets} from '../../../packages/rpc-control/src/runtime.ts';
export function rpcBudgetEndpoint(pool:()=>Pool,env:Readonly<Record<string,string|undefined>>){
 const budgets=readBudgets(env),store=budgets?new RpcControlStore(pool,env.TG_DATABASE_SCHEMA):undefined;
 return async(request:Request)=>{
  const secret=env.TG_RPC_BUDGET_TOKEN;
  const token=request.headers.get('authorization')??'';
  const hash=(v:string)=>createHash('sha256').update(v).digest();
  if(!store||!secret||secret.length<32||!timingSafeEqual(hash(token),hash(`Bearer ${secret}`)))return Response.json({error:'not_authorized'},{status:403});
  try{
   const body=await request.text();if(body.length>512)return Response.json({error:'invalid_request'},{status:400});
   const b=JSON.parse(body) as {action?:string;id?:string;provider?:string;tier?:RpcTier};
   if(b.action==='release'&&typeof b.id==='string'&&/^[0-9a-f-]{36}$/.test(b.id)){await store.release(b.id);return Response.json({ok:true});}
   if(b.action!=='acquire'||!b.provider||!budgets![b.provider]||!['interactive','realtime','background'].includes(b.tier??''))return Response.json({error:'invalid_request'},{status:400});
   const result=await store.acquire(`${env.TG_ENVIRONMENT}:${env.TG_CHAIN_ID}:${b.provider}`,b.tier!,budgets![b.provider]!);
   return Response.json({id:result.id});
  }catch(e){return Response.json({error:e instanceof RpcBudgetBusy?'rpc_capacity_busy':'rpc_budget_unavailable'},{status:e instanceof RpcBudgetBusy?429:503});}
 };
}
