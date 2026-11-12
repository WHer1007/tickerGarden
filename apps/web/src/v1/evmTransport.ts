import {selectedEvmChain} from './evmContext.ts';
export const EVM_GATEWAY_ORIGIN='https://api.tickergarden.com';
/** Only the explicit unified endpoint receives a selector. RPC, IPFS and signed PUTs stay byte-identical. */
export function scopedEvmUrl(input:string|URL,chainId:number,origin=EVM_GATEWAY_ORIGIN):string {
 const url=new URL(input,typeof location==='undefined'?'https://local.invalid':location.href??'https://local.invalid');
 if(url.origin!==origin)return String(input);
 if(![56,4663].includes(chainId))throw Error('Unsupported gateway chain');
 const ids=url.searchParams.getAll('chainId');
 if(ids.length>1||ids.length===1&&ids[0]!==String(chainId))throw Error('Conflicting gateway chain');
 url.searchParams.set('chainId',String(chainId));return url.href;
}
const selected=()=>Number(selectedEvmChain(import.meta.env??{},typeof window==='undefined'?'':window.location?.search??'')??4663);
export function evmUrl(input:string|URL):string{return scopedEvmUrl(input,selected());}
export const evmFetch:typeof fetch=(input,init)=>{
 const url=evmUrl(input instanceof Request?input.url:input);
 return globalThis.fetch(input instanceof Request?new Request(url,input):url,init);
};
