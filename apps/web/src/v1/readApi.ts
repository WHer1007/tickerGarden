import {TickerGardenV1Client as GeneratedClient} from './generated/read-api.ts';
import {evmUrl} from './evmTransport.ts';
export * from './generated/read-api.ts';
/** Transport binding, never a modification of generated business codecs. */
export class TickerGardenV1Client extends GeneratedClient {
 constructor(baseUrl:string,fetcher:typeof fetch=globalThis.fetch){super(baseUrl,(input,init)=>fetcher(input instanceof Request?new Request(evmUrl(input.url),input):evmUrl(input),init));}
}
