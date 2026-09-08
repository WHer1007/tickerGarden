import { isIPFSFileURI, ipfsGatewayURL } from "../create/ipfs.ts";
// Display content comes from the configured backend or trusted HTTPS IPFS gateway.
// HTTP objects are SHA-256 checked; IPFS resolution trusts the configured gateway (UnixFS CID is not a file SHA).
// Metadata fields never determine fee rules, routes or wallet transactions.
export function safeDetailLink(value:unknown,social=false):string|null{
 if(typeof value!=='string'||value.length>2048)return null;
 try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;if(social&&!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname))return null;return u.href;}catch{return null;}
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
 const v=JSON.parse(new TextDecoder().decode(raw)) as Record<string,unknown>;let image:string|null=null;
 if(typeof v.image==='string'&&isIPFSFileURI(v.image))image=ipfsGatewayURL(v.image,gateway);
 else if(typeof v.image==='string'){try{const u=new URL(v.image);if(u.origin===origin&&/^\/launch-metadata\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(u.pathname)&&!u.search&&!u.hash)image=u.href;}catch{}}
 const props=typeof v.properties==='object'&&v.properties!==null?v.properties as Record<string,unknown>:{};
 return {description:typeof v.description==='string'&&v.description.length<=10000?v.description:'',image,website:safeDetailLink(props.website??v.external_url),x:safeDetailLink(props.x,true)};
}

// Immutable content: retain successful reads, never failed or cancelled requests.
type Detail = NonNullable<Awaited<ReturnType<typeof fetchDetailMetadata>>>;
const contentCache = new Map<string,Detail>();
export async function readDetailMetadata(uri:string,origin:string|null,signal:AbortSignal,gateway?:string):Promise<Detail|null>{
 if(signal.aborted)return null;
 const key=JSON.stringify([uri,origin,gateway]);const cached=contentCache.get(key);
 if(cached)return {...cached};
 const result=await fetchDetailMetadata(uri,origin,signal,gateway);
 if(!result||signal.aborted)return null;
 if(contentCache.size>=128)contentCache.delete(contentCache.keys().next().value!);
 contentCache.set(key,{...result});return result;
}
