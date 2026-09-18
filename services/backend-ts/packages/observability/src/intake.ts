import type {Alert} from './lark.ts';
/** Trusted server configuration only; no redirect can forward the intake token. */
export async function deliverAlert(url:string,token:string,alert:Alert,fetcher:typeof fetch=fetch):Promise<boolean>{
 let endpoint:URL;try{endpoint=new URL(url);}catch{return false;}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/alerts'||token.length<32)return false;
 for(let attempt=0;attempt<2;attempt++){
  try{const response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(alert),signal:AbortSignal.timeout(1000),redirect:'error'});if(response.status===202)return true;if(response.status>=400&&response.status<500&&response.status!==429)return false;}catch{}
  if(attempt===0)await new Promise(r=>setTimeout(r,100));
 }
 return false;
}
