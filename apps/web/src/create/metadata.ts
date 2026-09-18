import type {UploadAuthorization} from './upload-auth.ts';
import { isIPFSFileURI } from "./ipfs.ts";
/** Immutable metadata is prepared only on explicit launch; typing never uploads a file. */
export type LaunchDetails = Readonly<{name:string;symbol:string;description:string;x:string;website:string;creatorFeesToHolders:boolean;creatorTaxBps:number;image?:string}>;
export function metadataOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Metadata service must use HTTPS (or localhost during development)');
  return url.origin;
}
export type PublishedMetadata = Readonly<{metadataURI:string; metadata?:Record<string,unknown>}>;
type UploadSession = {uploadId:string; accessToken:string; imageUpload:unknown; objectVersion?:string; uploaded:boolean; completed:boolean; result?:PublishedMetadata; touched:number};
const sessionCache = new Map<string,UploadSession>();
const SESSION_TTL_MS = 300_000;
const SESSION_CACHE_MAX = 8;
function sessionKey(origin:string, body:string, authorization:UploadAuthorization|undefined, sessionScope?:string):string { return `${origin}\n${body}\n${sessionScope ?? `${authorization?.nonce}\n${authorization?.signature}`}`; }
export function canResumeUpload(origin:string,details:LaunchDetails,sessionScope:string):boolean{const session=sessionCache.get(sessionKey(origin,JSON.stringify(details),undefined,sessionScope));return !!session&&Date.now()-session.touched<=SESSION_TTL_MS;}
function discardSession(key:string):void { sessionCache.delete(key); }
function saveSession(key:string, session:UploadSession):void {
  session.touched=Date.now(); sessionCache.delete(key); sessionCache.set(key,session);
  while(sessionCache.size>SESSION_CACHE_MAX) sessionCache.delete(sessionCache.keys().next().value!);
}
export async function publishLaunchMetadata(origin: string, details: LaunchDetails, authorization?:UploadAuthorization, sessionScope?:string): Promise<string> {
 return (await publishLaunchDetails(origin,details,authorization,sessionScope)).metadataURI;
}
/** sessionScope may be a stable, caller-authenticated owner context (for example chainId:account). */
export async function publishLaunchDetails(origin: string, details: LaunchDetails, authorization?:UploadAuthorization, sessionScope?:string): Promise<PublishedMetadata> {
  if(details.description.length>300)throw new Error('Description: max 300 characters.');
  if(!authorization&&(!sessionScope||!canResumeUpload(origin,details,sessionScope)))throw new Error('Upload Authorization Expired. Retry.');
  const body=JSON.stringify(details);
  const key=sessionKey(origin,body,authorization,sessionScope); let session=sessionCache.get(key);
  if(session && (Date.now()-session.touched>SESSION_TTL_MS)){discardSession(key);session=undefined;}
  if(session?.result)return session.result;
  if(!session){
    if(!authorization)throw Error('Upload Authorization Expired. Retry.');
    let response:Response;
    try{response=await fetch(`${origin}/v1/content/uploads`,{method:'POST',headers:{'content-type':'application/json','X-Upload-Nonce':authorization.nonce,'X-Upload-Signature':authorization.signature},body,signal:AbortSignal.timeout(10000)});}
    catch(error){if(error instanceof DOMException&&(error.name==='TimeoutError'||error.name==='AbortError'))throw Error('Publishing timed out. Retry.');throw Error('Cannot connect to publishing service. Retry.');}
    let parsedSession:{uploadId?:unknown;accessToken?:unknown;imageUpload?:unknown;error?:unknown};try{const parsed=await response.json();parsedSession=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as typeof parsedSession:{};}catch{parsedSession={};}
    if(!response.ok||typeof parsedSession.uploadId!=='string'||!/^[0-9a-f-]{36}$/.test(parsedSession.uploadId)||typeof parsedSession.accessToken!=='string'){
      if(response.status===401)throw Error('Upload Authorization Expired. Retry.');if(response.status===429)throw Error('Publishing limit reached. Try later.');
      if(parsedSession.error==='invalid_request')throw Error('Check your token details.');throw Error('Storage unavailable. Try again shortly.');
    }
    session={uploadId:parsedSession.uploadId,accessToken:parsedSession.accessToken,imageUpload:parsedSession.imageUpload,uploaded:parsedSession.imageUpload===null,completed:false,touched:Date.now()};saveSession(key,session);
  }
  if(session.imageUpload!==null && !session.uploaded){
    const upload=session.imageUpload as Record<string,unknown>;
    if(!details.image||typeof upload.url!=='string'||typeof upload.headers!=='object'||!upload.headers||upload.method!=='PUT'||typeof upload.byteLength!=='number'){discardSession(key);throw Error('Invalid Upload Session');}
    const match=/^data:image\/(?:png|jpeg|webp);base64,(.+)$/.exec(details.image);if(!match){discardSession(key);throw Error('Invalid Upload Session');}
    const binary=atob(match[1]!);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    if(bytes.byteLength!==upload.byteLength){discardSession(key);throw Error('Invalid Upload Session');}
    const put=await fetch(upload.url,{method:'PUT',headers:upload.headers as Record<string,string>,body:bytes,signal:AbortSignal.timeout(30000)});
    if(!put.ok){discardSession(key);throw Error('Storage unavailable. Try again shortly.');}session.objectVersion=put.headers.get('x-amz-version-id')??undefined;session.uploaded=true;saveSession(key,session);
  }
  if(!session.completed){const complete=await fetch(`${origin}/v1/content/uploads/${session.uploadId}/complete`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${session.accessToken}`},body:JSON.stringify(session.objectVersion?{objectVersion:session.objectVersion}:{}),signal:AbortSignal.timeout(10000)});if(!complete.ok){discardSession(key);if([401,403,404,409].includes(complete.status))throw Error('Invalid Upload Session');throw Error('Publishing failed. Try again.');}session.completed=true;saveSession(key,session);}
  const deadline=Date.now()+55000;
  while(Date.now()<deadline){
    const status=await fetch(`${origin}/v1/content/uploads/${session.uploadId}`,{headers:{authorization:`Bearer ${session.accessToken}`},signal:AbortSignal.timeout(5000)});
    if(status.status===401||status.status===403||status.status===404){discardSession(key);throw Error('Publishing failed. Try again.');}
    if(status.ok){const result=await status.json() as {status?:unknown;metadataURI?:unknown;metadata?:unknown};
      if(result.status==='ready'&&typeof result.metadataURI==='string'&&isIPFSFileURI(result.metadataURI)&&result.metadata&&typeof result.metadata==='object'&&!Array.isArray(result.metadata)){session.result={metadataURI:result.metadataURI,metadata:result.metadata as Record<string,unknown>};saveSession(key,session);return session.result;}
      if(result.status==='ready')throw Error('Invalid publishing response. Retry.');
      if(result.status==='failed'){discardSession(key);throw Error('Publishing failed. Try again.');}}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  saveSession(key,session); throw Error('Publishing timed out. Retry.');
}
export async function readTokenImage(file?: File): Promise<string | undefined> {
  if (!file) return undefined;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2*1024*1024 || file.size === 0) throw new Error('Use PNG, JPG or WebP (max 2 MB).');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Cannot read image. Choose another.'));reader.readAsDataURL(file);});
}
