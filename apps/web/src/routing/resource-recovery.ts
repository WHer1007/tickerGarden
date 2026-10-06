/** Recover only same-origin built CSS. Never reload the page or replay a wallet action. */
type Diagnostic={resourcePath:string;pagePath:string;online:string;visibility:string;retryCount:string};
const attempts=new Map<string,Promise<boolean>>();
let report:(error:Error,fields:Diagnostic)=>void=()=>{};
export function configureResourceRecovery(reporter:typeof report){report=reporter;}
export function builtCssPath(value:string):string|undefined{
 try{const url=new URL(value,location.origin);if(url.origin===location.origin&&/^\/assets\/[\w.-]+\.css$/.test(url.pathname))return url.pathname;}catch{}return undefined;
}
export function cssFailurePath(error:unknown):string|undefined{
 const message=error instanceof Error?error.message:'';const prefix='Unable to preload CSS for ';return message.startsWith(prefix)?builtCssPath(message.slice(prefix.length)):undefined;
}
export function resourceContext(resourcePath:string):Diagnostic{
 return {resourcePath,pagePath:(['/', '/explore','/create','/trade','/stats','/stats/stocks','/claim','/stake','/docs','/privacy','/terms'].includes(location.pathname)?location.pathname:'/other'),online:String(navigator.onLine),visibility:document.visibilityState,retryCount:'1'};
}
export function recoverStylesheet(value:string):Promise<boolean>{
 const path=builtCssPath(value);if(!path)return Promise.resolve(false);
 const existing=attempts.get(path);if(existing)return existing;
 // Bound memory and retry work. Successful entries remain so each asset retries at most once.
 if(attempts.size>=64)return Promise.resolve(false);
 let resolve!:(ok:boolean)=>void;const result=new Promise<boolean>(done=>{resolve=done;});attempts.set(path,result);
 const link=document.createElement('link');link.rel='stylesheet';link.href=path+'?tg-css-retry=1';link.dataset.resourceRetry='1';
 let finished=false;const done=(ok:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);if(!ok){link.remove();try{report(new Error('Stylesheet failed to load after retry'),resourceContext(path));}catch{/* Diagnostics must never block recovery completion. */}}resolve(ok);};
 const timer=setTimeout(()=>done(false),4_000);
 link.addEventListener('load',()=>done(true),{once:true});link.addEventListener('error',()=>done(false),{once:true});document.head.appendChild(link);
 return result;
}
export async function withCssRecovery<T>(load:()=>Promise<T>):Promise<T>{
 try{return await load();}catch(error){const path=cssFailurePath(error);if(!path||!await recoverStylesheet(path))throw error;return load();}
}
export function recoverInitialStylesheets(){
 for(const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')){
  if(!builtCssPath(link.href))continue;
  // Chromium can retain an inaccessible sheet after a failed crossorigin CSS request.
  try{if(link.sheet){void link.sheet.cssRules;continue;}}catch{}
  void recoverStylesheet(link.href);
 }
}
