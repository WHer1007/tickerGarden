export function reconcileVisibleCards<T extends {marketId:string},S>(input:{
 visibleIdsAtRequest:readonly string[];
 visibleIdsNow:readonly string[];
 generationAtRequest:string;
 generationNow:string;
 requestedIds:readonly string[];
 returned:readonly T[];
 previous:Record<string,S>;
 full:boolean;
 toStat:(item:T)=>S;
}):{stats:Record<string,S>;missing:string[]}|null{
 if(input.generationAtRequest!==input.generationNow||input.visibleIdsAtRequest.join(',')!==input.visibleIdsNow.join(','))return null;
 const requested=new Set(input.requestedIds),received=new Set<string>(),stats=input.full?{}:{...input.previous};
 for(const item of input.returned){if(!requested.has(item.marketId))continue;received.add(item.marketId);stats[item.marketId]=input.toStat(item);}
 const missing=input.requestedIds.filter(id=>!received.has(id));
 for(const id of missing)delete stats[id];
 return {stats,missing};
}

export function resolveExploreImageURI(uri:string|null|undefined,gateway?:string):string|null{
 if(!uri)return null;
 const ipfs=/^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})(\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$/.exec(uri);
 if(ipfs){
  if(!gateway)return null;
  try{const base=new URL(gateway),local=base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname);if((base.protocol!=='https:'&&!local)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)return null;
   const path=uri.slice(7+ipfs[1]!.length);if(path.split('/').some(part=>{try{const decoded=decodeURIComponent(part);return decoded==='.'||decoded==='..'||decoded.includes('/')||decoded.includes('\\');}catch{return true;}}))return null;
   return `${base.origin}/ipfs/${ipfs[1]}${path}`;
  }catch{return null;}
 }
 try{const url=new URL(uri);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
