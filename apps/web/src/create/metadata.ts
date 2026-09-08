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
export async function publishLaunchMetadata(origin: string, details: LaunchDetails): Promise<string> {
 return (await publishLaunchDetails(origin,details)).metadataURI;
}
export async function publishLaunchDetails(origin: string, details: LaunchDetails): Promise<PublishedMetadata> {
  let response: Response;
  try {
    response = await fetch(`${origin}/launch-metadata`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(details),signal:AbortSignal.timeout(55000)});
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new Error('Metadata service timed out. Please try again.');
    throw new Error('Could not reach metadata service. Check your connection and try again.');
  }
  let result: {metadataURI?:unknown;metadata?:Record<string,unknown>;code?:unknown;error?:unknown};
  try {
    const parsed = await response.json();
    result = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as typeof result : {};
  } catch { result = {}; }
  if (!response.ok || typeof result.metadataURI !== 'string') {
    const code = typeof result.code === 'string' ? result.code : typeof result.error === 'string' ? result.error : '';
    if (code === 'content_quota_exhausted') throw new Error('Metadata publication quota is exhausted. Please try again later.');
    if (code === 'content_busy') throw new Error('Metadata service is busy. Please try again shortly.');
    if (code === 'content_store_unavailable') throw new Error('Metadata storage is temporarily unavailable. Please try again shortly.');
    if (code === 'metadata_publication_failed') throw new Error('Metadata publication failed. Please try again shortly.');
    if (code === 'invalid_request') throw new Error('Token details are invalid. Check the fields and try again.');
    if (response.status === 429) throw new Error('Metadata service is busy. Please try again shortly.');
    if (response.status === 503) throw new Error('Metadata storage is temporarily unavailable. Please try again shortly.');
    throw new Error('Token details could not be saved. Please try again.');
  }
  if (isIPFSFileURI(result.metadataURI)) return {metadataURI:result.metadataURI,metadata:result.metadata};
  const url = new URL(result.metadataURI);
  if (url.origin !== origin || !/^\/launch-metadata\/[a-f0-9]{64}\.json$/.test(url.pathname) || url.search || url.hash) throw new Error('Metadata service returned an unexpected URL');
  return {metadataURI:url.href,metadata:result.metadata};
}
export async function readTokenImage(file?: File): Promise<string | undefined> {
  if (!file) return undefined;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2*1024*1024 || file.size === 0) throw new Error('Choose a PNG, JPG or WebP image up to 2 MB');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read token image'));reader.readAsDataURL(file);});
}
