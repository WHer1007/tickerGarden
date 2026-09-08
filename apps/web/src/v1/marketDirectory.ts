import type {ListMarketsParams,MarketPage} from './generated/read-api.ts';
import {assertFinalizedSync} from '../runtime/model.ts';
export type DirectoryQuery=Omit<ListMarketsParams,'cursor'|'limit'> & {revision:string};
export function createMarketDirectory(fetchPage:(params:ListMarketsParams,signal:AbortSignal)=>Promise<MarketPage>){
 let generation=0,controller:AbortController|null=null,key='',state:MarketPage|null=null;
 const reset=()=>{generation++;controller?.abort();controller=null;key='';state=null;};
 return{reset,async load(query:DirectoryQuery,append=false):Promise<MarketPage|null>{
  const nextKey=JSON.stringify(query);
  if(nextKey===key&&state&&!append){generation++;controller?.abort();controller=null;return state;}
  const previous=nextKey===key?state:null;
  if(append&&!previous?.nextCursor)throw new Error('No matching directory page to continue');
  const own=++generation;controller?.abort();const abort=new AbortController();controller=abort;
  const timer=setTimeout(()=>abort.abort(),10000);
  try{
   const page=await fetchPage({...query,limit:100,...(append?{cursor:previous!.nextCursor!}:{})},abort.signal);
   if(own!==generation)return null;if(abort.signal.aborted)throw new Error('Directory query timed out');
   assertFinalizedSync(page.sync,query.revision,'market query');
   if(!Array.isArray(page.items)||page.items.length>100||(page.nextCursor!==null&&(typeof page.nextCursor!=='string'||page.nextCursor.length===0||page.nextCursor.length>8192||page.items.length===0||page.nextCursor===previous?.nextCursor)))throw new Error('Invalid market query page');
   const items=[...(append?previous!.items:[]),...page.items],seen=new Set<string>();
   for(const m of items){if(!m||!/^0x[0-9a-f]{64}$/.test(m.marketId)||seen.has(m.marketId))throw new Error('Duplicate or invalid market identity');seen.add(m.marketId);}
   state={...page,items};key=nextKey;return state;
  }catch(error){if(own!==generation)return null;state=null;key='';throw error;}
  finally{clearTimeout(timer);if(own===generation)controller=null;}
 }};
}
