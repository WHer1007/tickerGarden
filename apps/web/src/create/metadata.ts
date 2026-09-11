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
export async function publishLaunchMetadata(origin: string, details: LaunchDetails, authorization?:UploadAuthorization): Promise<string> {
 return (await publishLaunchDetails(origin,details,authorization)).metadataURI;
}
export async function publishLaunchDetails(origin: string, details: LaunchDetails, authorization?:UploadAuthorization): Promise<PublishedMetadata> {
  if(details.description.length>300)throw new Error('Description: max 300 characters.');
  if(!authorization)throw new Error('Upload Authorization Expired. Retry.');
  const body=JSON.stringify(details);
  let response:Response;
  try{response=await fetch(`${origin}/v1/content/uploads`,{method:'POST',headers:{'content-type':'application/json','X-Upload-Nonce':authorization.nonce,'X-Upload-Signature':authorization.signature},body,signal:AbortSignal.timeout(10000)});}
  catch(error){if(error instanceof DOMException&&(error.name==='TimeoutError'||error.name==='AbortError'))throw Error('Publishing timed out. Retry.');throw Error('Cannot connect to publishing service. Retry.');}
  let session:{uploadId?:unknown;accessToken?:unknown;imageUpload?:unknown;error?:unknown};try{const parsed=await response.json();session=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as typeof session:{};}catch{session={};}
  if(!response.ok||typeof session.uploadId!=='string'||!/^[0-9a-f-]{36}$/.test(session.uploadId)||typeof session.accessToken!=='string'){
    if(response.status===401)throw Error('Upload Authorization Expired. Retry.');if(response.status===429)throw Error('Publishing limit reached. Try later.');
    if(session.error==='invalid_request')throw Error('Check your token details.');throw Error('Storage unavailable. Try again shortly.');
  }
  let objectVersion:string|undefined;
  if(session.imageUpload!==null){
    const upload=session.imageUpload as Record<string,unknown>;
    if(!details.image||typeof upload.url!=='string'||typeof upload.headers!=='object'||!upload.headers||upload.method!=='PUT'||typeof upload.byteLength!=='number')throw Error('Invalid Upload Session');
    const match=/^data:image\/(?:png|jpeg|webp);base64,(.+)$/.exec(details.image);if(!match)throw Error('Invalid Upload Session');
    const binary=atob(match[1]!);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    if(bytes.byteLength!==upload.byteLength)throw Error('Invalid Upload Session');
    const put=await fetch(upload.url,{method:'PUT',headers:upload.headers as Record<string,string>,body:bytes,signal:AbortSignal.timeout(30000)});
    if(!put.ok)throw Error('Storage unavailable. Try again shortly.');objectVersion=put.headers.get('x-amz-version-id')??undefined;
  }
  const complete=await fetch(`${origin}/v1/content/uploads/${session.uploadId}/complete`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${session.accessToken}`},body:JSON.stringify(objectVersion?{objectVersion}:{}),signal:AbortSignal.timeout(10000)});
  if(!complete.ok)throw Error('Publishing failed. Try again.');
  const deadline=Date.now()+55000;
  while(Date.now()<deadline){
    const status=await fetch(`${origin}/v1/content/uploads/${session.uploadId}`,{headers:{authorization:`Bearer ${session.accessToken}`},signal:AbortSignal.timeout(5000)});
    if(status.ok){const result=await status.json() as {status?:unknown;metadataURI?:unknown;metadata?:unknown};
      if(result.status==='ready'&&typeof result.metadataURI==='string'&&isIPFSFileURI(result.metadataURI)&&result.metadata&&typeof result.metadata==='object'&&!Array.isArray(result.metadata))return {metadataURI:result.metadataURI,metadata:result.metadata as Record<string,unknown>};
      if(result.status==='ready')throw Error('Invalid publishing response. Retry.');
      if(result.status==='failed')throw Error('Publishing failed. Try again.');}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('Publishing timed out. Retry.');
}
export async function readTokenImage(file?: File): Promise<string | undefined> {
  if (!file) return undefined;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2*1024*1024 || file.size === 0) throw new Error('Use PNG, JPG or WebP (max 2 MB).');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Cannot read image. Choose another.'));reader.readAsDataURL(file);});
}
