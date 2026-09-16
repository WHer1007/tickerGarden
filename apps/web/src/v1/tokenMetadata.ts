import { isIPFSFileURI, ipfsGatewayURL } from "../create/ipfs.ts";
// Display content comes from the configured backend or trusted HTTPS IPFS gateway (localhost HTTP is development-only).
// HTTP objects are SHA-256 checked; IPFS resolution trusts the configured gateway (UnixFS CID is not a file SHA).
// Metadata fields never determine fee rules, routes or wallet transactions.
export function safeDetailLink(value:unknown,social=false):string|null{
 if(typeof value!=='string'||value.length>2048)return null;
 try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;if(social&&!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname))return null;return u.href;}catch{return null;}
}
function detailFromObject(v:Record<string,unknown>,origin:string|null,gateway?:string):{description:string;image:string|null;website:string|null;x:string|null}{
 let image:string|null=null;
 if(typeof v.image==='string'&&isIPFSFileURI(v.image))image=ipfsGatewayURL(v.image,gateway);
 else if(typeof v.image==='string'){try{const u=new URL(v.image);if(u.origin===origin&&/^\/launch-metadata\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(u.pathname)&&!u.search&&!u.hash)image=u.href;}catch{}}
 const props=typeof v.properties==='object'&&v.properties!==null?v.properties as Record<string,unknown>:{};
 return {description:typeof v.description==='string'&&v.description.length<=10000?v.description:'',image,website:safeDetailLink(props.website??v.external_url),x:safeDetailLink(props.x,true)};
}
async function fetchDetailMetadata(uri:string,origin:string|null,signal:AbortSignal,gateway?:string):Promise<{description:string;image:string|null;website:string|null;x:string|null}|null>{
 const ipfs=isIPFSFileURI(uri);
 if(!ipfs&&!origin)return null;let url:URL;try{url=new URL(ipfs?ipfsGatewayURL(uri,gateway)??"":uri);}catch{return null;}
 if(!ipfs&&(url.origin!==origin||!/^\/launch-metadata\/[a-f0-9]{64}\.json$/.test(url.pathname)||url.search||url.hash))return null;
 const response=await fetch(url,{signal,redirect:'error'});if(!response.ok)return null;
 const reader=response.body?.getReader();if(!reader)return null;let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return null;}chunks.push(value);}
 const raw=new Uint8Array(size);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.length;}
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(b=>b.toString(16).padStart(2,'0')).join('');if(!ipfs&&!url.pathname.endsWith(`${digest}.json`))return null;
 const v=JSON.parse(new TextDecoder().decode(raw)) as Record<string,unknown>;
 return detailFromObject(v,origin,gateway);
}

// Immutable content: retain successful reads, never failed or cancelled requests.
type Detail = NonNullable<Awaited<ReturnType<typeof fetchDetailMetadata>>>;
const contentCache = new Map<string,Detail>();
const inFlight = new Map<string,Promise<Detail|null>>();
const DETAIL_REQUEST_TIMEOUT_MS=8000;

/** Use the canonical object returned by the authenticated publisher while an IPFS gateway catches up. */
export function rememberDetailMetadata(uri:string,metadata:Record<string,unknown>,origin:string|null,gateway?:string):void{
 if(!isIPFSFileURI(uri))return;
 const key=JSON.stringify([uri,origin,gateway]);
 if(contentCache.size>=128&&!contentCache.has(key))contentCache.delete(contentCache.keys().next().value!);
 contentCache.set(key,detailFromObject(metadata,origin,gateway));
}

function forConsumer<T>(request:Promise<T>,signal:AbortSignal):Promise<T|null>{
 if(signal.aborted)return Promise.resolve(null);
 return new Promise<T|null>(resolve=>{
  const done=()=>{signal.removeEventListener('abort',aborted);resolve(null);};
  const aborted=()=>done();
  signal.addEventListener('abort',aborted,{once:true});
  request.then(value=>{signal.removeEventListener('abort',aborted);if(!signal.aborted)resolve(value);},()=>{signal.removeEventListener('abort',aborted);if(!signal.aborted)resolve(null);});
 });
}
export async function readDetailMetadata(uri:string,origin:string|null,signal:AbortSignal,gateway?:string):Promise<Detail|null>{
 if(signal.aborted)return null;
 const key=JSON.stringify([uri,origin,gateway]);const cached=contentCache.get(key);
 if(cached)return {...cached};
 let request=inFlight.get(key);
  if(!request){
   const controller=new AbortController();
   let timedOut=false;
   const fetchRequest=fetchDetailMetadata(uri,origin,controller.signal,gateway).catch(()=>null);
   request=new Promise<Detail|null>(resolve=>{
    const cacheAndResolve=(result:Detail|null)=>{
     if(!timedOut&&result){
      if(contentCache.size>=128)contentCache.delete(contentCache.keys().next().value!);
      contentCache.set(key,{...result});
     }
     resolve(timedOut?null:result);
    };
    const timer=setTimeout(()=>{timedOut=true;controller.abort();resolve(null);},DETAIL_REQUEST_TIMEOUT_MS);
    fetchRequest.then(result=>{clearTimeout(timer);cacheAndResolve(result);});
   }).finally(()=>{if(inFlight.get(key)===request)inFlight.delete(key);});
   inFlight.set(key,request);
  }
 const result=await forConsumer(request,signal);
 return result?{...result}:null;
}
