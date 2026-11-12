/** Called only by a validated active HTTP price request. No timers or startup work. */
export function createRequestedPriceRefresh(env:Readonly<Record<string,string|undefined>>,fetcher:typeof fetch=fetch) {
 let pending:Promise<void>|undefined;let pendingKey='';const completed=new Map<string,number>();
 return async(requestId:string,tokens?:readonly string[])=>{
  if(env.TG_ENVIRONMENT!=='production')return;
  const key=tokens?.join(',')??'*';
  for(const [k,at] of completed)if(Date.now()-at>=15000)completed.delete(k);
  if(completed.has(key))return;
  if(pending){if(pendingKey!==key)throw Error('Requested price capacity is busy');return pending;}
  pendingKey=key;
  pending=(async()=>{
   if(!env.TG_REQUESTED_PRICE_ORIGIN||!env.TG_REQUESTED_PRICE_TOKEN)throw Error('Requested price refresh is unconfigured');
   const response=await fetcher(new URL('/internal/prices/refresh',env.TG_REQUESTED_PRICE_ORIGIN),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.TG_REQUESTED_PRICE_TOKEN,'x-tg-candidate-token':env.TG_CANDIDATE_ACCESS_TOKEN??'','x-vercel-protection-bypass':env.TG_REQUESTED_PRICE_BYPASS??''},body:JSON.stringify({requestId,reason:'active-read',...(tokens?{tokens}:{})}),signal:AbortSignal.timeout(25000)});
   if(!response.ok)throw Error('Requested price refresh unavailable');
   await response.body?.cancel();if(completed.size>=64)completed.delete(completed.keys().next().value!);completed.set(key,Date.now());
  })();
  try{await pending;}finally{pending=undefined;}
 };
}

/** Reuse only a recently completed persisted batch; never serve stale prices. */
export function canReuseRequestedPrices(references:ReadonlyArray<{status:string;retrievedAt:string;expiresAt:string|null;reason?:string}>,now=Date.now()):boolean {
 return references.length>0&&references.every(r=>{
  const age=now-Date.parse(r.retrievedAt);
  return Number.isFinite(age)&&age>=0&&r.reason!=='not_refreshed'
   &&((r.status==='unavailable'&&age<15_000)||(r.status==='available'&&r.expiresAt!==null&&Date.parse(r.expiresAt)>now+(age<15000?0:10000)));
 });
}
