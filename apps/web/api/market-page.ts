import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {renderMetadata} from '../src/routing/metadata.ts';

export async function marketPage(request:Request, shell:string, env:Record<string,string|undefined>, fetcher:typeof fetch=fetch):Promise<Response>{
 const url=new URL(request.url);const raw=url.searchParams.get('marketId')??'';
 const id=/^0x[0-9a-f]{64}$/i.test(raw)?raw.toLowerCase():null;
 let metadata=renderMetadata('trade',id?`/trade?marketId=${id}`:'/trade');let found=false;
 if(id&&env.VITE_V1_READ_API_URL){try{
  const endpoint=new URL(`/v1/markets/${id}`,env.VITE_V1_READ_API_URL);endpoint.searchParams.set('includeRecent','false');
  const response=await fetcher(endpoint,{signal:AbortSignal.timeout(2000),redirect:'error'});
  if(!response.ok)throw Error('Market unavailable');
  const data=await response.json();
  if(data.market?.marketId!==id||Number(data.sync?.chainId)!==Number(env.VITE_V1_CHAIN_ID))throw Error('Market mismatch');
  const identity=data.market?.identity;
  if(typeof identity?.name==='string'&&typeof identity?.symbol==='string'){
   const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
   const name=escape(identity.name.slice(0,80));const symbol=escape(identity.symbol.slice(0,24));
   metadata=metadata.replaceAll('Trade a market — TickerGarden',`${name} (${symbol}) — TickerGarden`);found=true;
  }
 }catch{/* The trading shell stays available when the public directory is delayed. */}}
 const html=shell.replace(/<title>[\s\S]*?<\/title>/g,'').replace(/<meta\s+(?:name|property)="(?:description|robots|theme-color|og:[^"]+|twitter:[^"]+)"[^>]*>/g,'').replace(/<link\s+rel="canonical"[^>]*>/g,'').replace('</head>',`${metadata}</head>`);
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':found?'public, max-age=0, s-maxage=60, stale-while-revalidate=300':'no-store'}});
}
export async function GET(request:Request){return marketPage(request,await readFile(join(process.cwd(),'dist/market-shell.html'),'utf8'),process.env);}

export default {
 async fetch(request:Request):Promise<Response>{
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  const response=await GET(request);
  return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
 }
};
