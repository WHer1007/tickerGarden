import {RpcTransport,type RpcTransportOptions} from '../../chain/src/index.ts';

const METHODS=new Set(['eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_getBalance','eth_sendRawTransaction']);
/** Explicit operator transport. Shared indexer transport remains read-only.
 * No automatic send retries: recovery belongs to the durable intent journal.
 */
export class PublicationRpcTransport extends RpcTransport {
 readonly #publicationUrl:string;
 readonly #publicationFetch:typeof fetch;
 readonly #publicationTimeout:number;
 #publicationRequest=0;
 constructor(options:RpcTransportOptions){super(options);this.#publicationUrl=options.url;this.#publicationFetch=options.fetch??fetch;this.#publicationTimeout=options.timeoutMs??20000;}
 override async call<T>(method:string,params:readonly unknown[]):Promise<T>{
  if(!METHODS.has(method))return super.call<T>(method,params);
  const id=++this.#publicationRequest;
  try{
   const response=await this.#publicationFetch(this.#publicationUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(this.#publicationTimeout)});
   if(!response.ok||!response.body||Number(response.headers.get('content-length')??0)>1048576)throw Error();
   const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1048576){await reader.cancel();throw Error();}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
   const value=JSON.parse(text) as {id?:number;error?:unknown;result?:T};
   if(value.id!==id||value.error||!('result'in value))throw Error();
   if(typeof value.result!=='string'||!(method==='eth_sendRawTransaction'?/^0x[0-9a-f]{64}$/i:/^0x(?:0|[1-9a-f][0-9a-f]*)$/i).test(value.result))throw Error();
   return value.result as T;
  }catch{throw Error('Publication RPC request failed');}
 }
}
