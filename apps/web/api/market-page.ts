import {pageMetadata} from '../src/routing/metadata.ts';
import {webRequestId,reportWebError} from '../server/diagnostics.ts';
import {readFile} from 'node:fs/promises';

export async function marketPage(request:Request, shell:string, env:Record<string,string|undefined>, fetcher:typeof fetch=fetch):Promise<Response>{
 const requestId=webRequestId();
 const url=new URL(request.url);const raw=url.searchParams.get('marketId')??'';
 const id=/^0x[0-9a-f]{64}$/i.test(raw)?raw.toLowerCase():null;
 let html=shell;let found=false;
 const metadata=pageMetadata('trade',url.pathname+url.search);
 const canonical=metadata.canonical.replaceAll('&','&amp;');
 const description=metadata.description.replaceAll('&','&amp;').replaceAll('"','&quot;');
 html=html.replace(/(<meta (?:name="description"|property="og:description"|name="twitter:description") content=")[^"]*/g,(_,open)=>open+description);
 html=html.replace(/(<link rel="canonical" href=")[^"]*/g,`$1${canonical}`).replace(/(<meta property="og:url" content=")[^"]*/g,`$1${canonical}`);
 const bsc=url.searchParams.get('chain')==='bsc';
 const supported=!url.searchParams.has('chain')||['bsc','rh','evm'].includes(url.searchParams.get('chain')!);
 const chainId=bsc?56:Number(env.VITE_V1_CHAIN_ID);
 const api=bsc?env.VITE_BSC_READ_API_URL:env.VITE_V1_READ_API_URL;
 if(id&&api&&supported){try{
  const endpoint=new URL(`/v1/markets/${id}`,api);endpoint.searchParams.set('includeRecent','false');endpoint.searchParams.set('chainId',String(chainId));
  const response=await fetcher(endpoint,{signal:AbortSignal.timeout(2000),redirect:'error'});
  if(!response.ok)throw Error('Market unavailable');
  const data=await response.json();
  if(data.market?.marketId!==id||Number(data.sync?.chainId)!==chainId)throw Error('Market mismatch');
  const identity=data.market?.identity;
  if(typeof identity?.name==='string'&&typeof identity?.symbol==='string'){
   const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
   const name=escape(identity.name.slice(0,80));const symbol=escape(identity.symbol.slice(0,24));
   html=html.replaceAll('Trade a market — TickerGarden',`${name} (${symbol}) — TickerGarden`);found=true;
  }
 }catch(error){reportWebError('market_metadata_unavailable',error,{requestId,step:'metadata'});/* The trading shell stays available. */}}

 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8',...(shell.includes('data-search-index="deny"')?{'X-Robots-Tag':'noindex, nofollow'}:{}),'Cache-Control':found?'public, max-age=0, s-maxage=60, stale-while-revalidate=300':'no-store'}});
}
export async function GET(request:Request){return marketPage(request,await readFile(new URL('../dist/market-shell.html',import.meta.url),'utf8'),process.env);}

export default {
 async fetch(request:Request):Promise<Response>{
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  const response=await GET(request);
  return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
 }
};
