import {keccak256,decodeEventLog,parseAbi} from '../../apps/web/node_modules/viem/_esm/index.js';
// Enforce project scope before cache lookup as well as before upstream traffic.
const CREATED_ABI=parseAbi(['event MarketCreated(bytes32 indexed marketId, bytes32 indexed assetUid, address indexed memeToken, address curve, address gauge, address quoteAsset, bytes32 tickerGardenBaselineId, bytes32 quoteAssetConfigId, bytes32 expectedEconomics)']);
const CREATED_TOPIC=keccak256(new TextEncoder().encode('MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)'));
const BINDING_ABI=parseAbi(['event PoolBindingActivated(bytes32 indexed marketId, bytes32 indexed poolId, uint32 sourceVersion)']);
const BINDING_TOPIC=keccak256(new TextEncoder().encode('PoolBindingActivated(bytes32,bytes32,uint32)'));
const ADDRESS=/^0x[0-9a-f]{40}$/;
const HASH=/^0x[0-9a-f]{64}$/;
const number=x=>typeof x==='string'&&/^0x[0-9a-f]+$/.test(x)?Number(BigInt(x)):NaN;
export class ProjectScope {
 constructor(config){
  if(!Number.isSafeInteger(config.startBlock)||config.startBlock<1||!Array.isArray(config.contracts)||!config.contracts.length)throw Error('Explicit project history scope required');
  this.wallets=new Set(config.wallets??[]);if([...this.wallets].some(a=>!ADDRESS.test(a)))throw Error("Invalid wallet scope");this.start=config.startBlock;this.maxRange=config.maxLogRange??512;
  this.origin=config.originProof;this.headerEventProofs=config.headerEventProofs===true;
  if(this.origin&&(!Number.isSafeInteger(this.origin.parentBlock)||this.origin.parentBlock!==this.start-1||!Number.isSafeInteger(this.origin.businessBlock)||this.origin.businessBlock<this.start||this.origin.businessBlock-this.start>4096||!Array.isArray(this.origin.addresses)||!this.origin.addresses.length||this.origin.addresses.some(a=>!ADDRESS.test(a))))throw Error('Invalid origin proof scope');
  if(!Number.isSafeInteger(this.maxRange)||this.maxRange<1||this.maxRange>2048)throw Error('Invalid log range');
  this.discoveries=new Map();this.discoveryRevision=0;this.contracts=new Map();this.headers=new Map();this.transactions=new Set();this.proofBlocks=new Set();
  for(const c of config.contracts){if(!ADDRESS.test(c.address)||!Number.isSafeInteger(c.fromBlock)||c.fromBlock<this.start||!c.reason)throw Error('Invalid contract scope');if(c.shared&&(!Array.isArray(c.poolIds)||c.poolIds.some(x=>!HASH.test(x))))throw Error('Shared contract pool scope required');this.contracts.set(c.address,c);}
 }
 discover(log){
  const emitter=this.contracts.get(log.address?.toLowerCase());
  if(emitter?.module==='TickerGardenMemeHook'&&log.topics?.[0]===BINDING_TOPIC){
   const n=number(log.blockNumber);if(!Number.isSafeInteger(n)||n<emitter.fromBlock||log.removed)throw Error('Invalid pool binding scope');
   const {args}=decodeEventLog({abi:BINDING_ABI,data:log.data,topics:log.topics,strict:true});
   if(![...this.contracts.values()].some(c=>c.marketId===args.marketId))throw Error('Pool binding requires a discovered market');
   const managers=[...this.contracts.values()].filter(c=>c.shared&&c.module==='UniswapV4PoolManager');
   if(managers.length!==1||args.poolId==='0x'+'0'.repeat(64))throw Error('Ambiguous pool manager scope');
   const key=log.transactionHash+':'+log.logIndex;
   if(!this.discoveries.has(key)){if(this.discoveries.size>=4096)throw Error('Market scope limit exceeded');this.discoveries.set(key,log);this.discoveryRevision++;}
   if(!managers[0].poolIds.includes(args.poolId))managers[0].poolIds.push(args.poolId);
   return;
  }
  const factory=this.contracts.get(log.address?.toLowerCase());
  if(factory?.module!=='TickerGardenFactoryV1'||log.topics?.[0]!==CREATED_TOPIC)return;
  const n=number(log.blockNumber);if(!Number.isSafeInteger(n)||n<factory.fromBlock||log.removed)throw Error('Invalid market creation scope');
  const {args}=decodeEventLog({abi:CREATED_ABI,data:log.data,topics:log.topics,strict:true});
  const additions=[];
  for(const [field,module] of [['memeToken','TickerMemeTokenV1'],['curve','TickerGardenCurve'],['gauge','MemeStockGauge']]){
   const address=args[field].toLowerCase();if(address==='0x'+'0'.repeat(40)){if(field==='gauge')continue;throw Error('Missing market child');}
   const old=this.contracts.get(address);if(old&&(old.module!==module||old.fromBlock!==n))throw Error('Conflicting market child scope');
   additions.push({address,module,fromBlock:n,reason:'Child from scoped Factory MarketCreated',marketId:args.marketId});
  }
  for(const c of additions)this.contracts.set(c.address,c);
  const key=log.transactionHash+':'+log.logIndex;if(!this.discoveries.has(key)){if(this.discoveries.size>=4096)throw Error('Market scope limit exceeded');this.discoveries.set(key,log);this.discoveryRevision++;}
 }
 restoreDiscoveries(logs){if(!Array.isArray(logs)||logs.length>4096)throw Error('Invalid market scope journal');for(const log of logs)this.discover(log);}

 check(method,params){
  if(method==='eth_blockNumber'||method==='eth_chainId'||method==='eth_gasPrice'||method==='eth_maxPriorityFeePerGas')return;
  if(method==='eth_getTransactionCount'&&this.wallets.has(params[0]?.toLowerCase())&&['latest','pending'].includes(params[1]))return;
  if(method==='eth_getBalance'&&ADDRESS.test(params[0]?.toLowerCase()??'')&&['latest','pending'].includes(params[1]))return;
  if(method==='eth_estimateGas'){if(!this.contracts.has(params[0]?.to?.toLowerCase()))throw Error('Simulation outside project scope');return;}
  if(method==='eth_getBlockByNumber'){
   const n=number(params[0]);if(params[1]!==false||(!['latest','finalized'].includes(params[0])&&n!==0&&n!==this.origin?.parentBlock&&!(n>=this.start)))throw Error('Block outside project scope');return;
  }
  if(method==='eth_getBlockByHash'){if(params[1]!==false||!this.headers.has(params[0]))throw Error('Unrequested block hash');return;}
  if(method==='eth_getTransactionReceipt'||method==='eth_getTransactionByHash'){if(!HASH.test(params[0]))throw Error('Invalid transaction hash');return;}
  if(method==='eth_getBlockReceipts'){if(!this.proofBlocks.has(params[0]))throw Error('Full receipts require a project event block');return;}
  if(['eth_call','eth_getCode','eth_getBalance','eth_getStorageAt','eth_getTransactionCount'].includes(method)){
   const a=(method==='eth_call'?params[0]?.to:params[0])?.toLowerCase();const c=this.contracts.get(a);if(!c)throw Error('State target outside project scope');
   const tag=params[method==='eth_getStorageAt'?2:1];const n=tag?.blockHash?this.headers.get(tag.blockHash):number(tag);const originCode=method==='eth_getCode'&&this.origin?.addresses.includes(a)&&[this.origin.parentBlock,this.origin.businessBlock].includes(n);if(!originCode&&!['latest','finalized'].includes(tag)&&!(n>=c.fromBlock))throw Error('State before contract scope');return;
  }
  if(method!=='eth_getLogs')throw Error('Method outside project scope');
  const f=params[0];const addresses=typeof f?.address==='string'?[f.address]:f?.address;
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>64)throw Error('Explicit log addresses required');
  const from=f.blockHash?this.headers.get(f.blockHash):number(f.fromBlock),to=f.blockHash?from:number(f.toBlock);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||to<from||to-from+1>this.maxRange)throw Error('Unbounded log range');
  for(const a of addresses){const c=this.contracts.get(a.toLowerCase());if(!c||c.logs===false||from<c.fromBlock)throw Error('Log history outside contract scope');if(c.shared){const ids=Array.isArray(f.topics?.[1])?f.topics[1]:[f.topics?.[1]];if(!ids.length||ids.some(id=>!c.poolIds.includes(id)))throw Error('Shared PoolManager requires project pool IDs');}}
 }
 observe(method,params,result){
  if(method==='eth_getTransactionByHash'&&result){if(result.hash!==params[0]||!this.contracts.has(result.to?.toLowerCase()))throw Error('Transaction target outside project scope');}

  if(method==='eth_getTransactionReceipt'&&result){
   if(result.transactionHash!==params[0]||!this.contracts.has(result.to?.toLowerCase()))throw Error('Receipt target outside project scope');
   this.transactions.add(params[0]);
   for(const l of result.logs??[])if(this.contracts.has(l.address?.toLowerCase()))this.discover(l);
  }
  if(['eth_getBlockByNumber','eth_getBlockByHash'].includes(method)&&result&&HASH.test(result.hash)){
   const n=number(result.number);if(n>=this.start||n===this.origin?.parentBlock)this.headers.set(result.hash,n);
   if(this.headerEventProofs&&/^0x[0-9a-fA-F]{512}$/.test(result.logsBloom??'')){
    const bloom=Buffer.from(result.logsBloom.slice(2),'hex');
    const includes=value=>{const digest=Buffer.from(keccak256(value).slice(2),'hex');for(let i=0;i<6;i+=2){const bit=((digest[i]<<8)|digest[i+1])&2047;if(!(bloom[255-(bit>>3)]&(1<<(bit&7))))return false;}return true;};
    for(const c of this.contracts.values())if(c.logs!==false&&n>=c.fromBlock&&includes(c.address)&&(!c.shared||c.poolIds.some(includes))){this.proofBlocks.add(result.hash);break;}
   }
  }
  if(method==='eth_getLogs'&&Array.isArray(result)){
   const f=params[0],addresses=(Array.isArray(f.address)?f.address:[f.address]).map(a=>a.toLowerCase());
   for(const l of result){const n=number(l.blockNumber),c=this.contracts.get(l.address?.toLowerCase());if(!c||!addresses.includes(l.address.toLowerCase())||n<c.fromBlock||l.removed||!HASH.test(l.blockHash)||!HASH.test(l.transactionHash))throw Error('RPC log outside requested scope');if(f.blockHash?l.blockHash!==f.blockHash:n<number(f.fromBlock)||n>number(f.toBlock))throw Error('RPC log outside requested range');if(c.shared&&!c.poolIds.includes(l.topics?.[1]))throw Error('Unrelated shared pool log');}
   for(const l of result){const n=number(l.blockNumber);this.headers.set(l.blockHash,n);this.proofBlocks.add(l.blockHash);this.transactions.add(l.transactionHash);this.discover(l);}
  }
 }
}
