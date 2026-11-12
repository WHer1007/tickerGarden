import {TickerGardenV1Client as GeneratedClient} from './generated/read-api.ts';
import {evmUrl} from './evmTransport.ts';
import type {DisplayPriceResponse} from './generated/read-api.ts';
export * from './generated/read-api.ts';
/** Transport binding, never a modification of generated business codecs. */
export class TickerGardenV1Client extends GeneratedClient {
 constructor(baseUrl:string,fetcher:typeof fetch=globalThis.fetch){super(baseUrl,(input,init)=>fetcher(input instanceof Request?new Request(evmUrl(input.url),input):evmUrl(input),init));}
 async listSelectedDisplayPrices(tokens:readonly string[]):Promise<DisplayPriceResponse>{
  if(!tokens.length||tokens.length>96||new Set(tokens).size!==tokens.length||tokens.some(t=>!/^0x[0-9a-f]{40}$/.test(t)))throw Error('Invalid display price tokens');
  const url=new URL('/v1/prices/references',this.baseUrl);url.searchParams.set('tokens',[...tokens].sort().join(','));
  const response=await this.fetcher(url,{method:'GET',headers:{accept:'application/json'}});if(!response.ok)throw Error('Selected display prices unavailable');return response.json() as Promise<DisplayPriceResponse>;
 }
}
