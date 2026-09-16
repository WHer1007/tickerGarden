// Read-only evidence collector. No wallet, private key, signing or broadcast.
import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,http,parseAbi,parseAbiItem,keccak256} from '../../apps/web/node_modules/viem/_esm/index.js';
const out=process.argv[2]||'outputs/reviews/rh-mainnet-stock-catalog-2026-09-12';
process.on('uncaughtException',e=>{console.error('Research RPC operation failed:',e.name);process.exit(1)});
process.on('unhandledRejection',e=>{console.error('Research RPC operation failed:',e?.name||'UnknownError');process.exit(1)});
const env=p=>fs.existsSync(p)?Object.fromEntries(fs.readFileSync(p,'utf8').split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]})):{};
const e=env('.env.master.local'),t=env('.env.test.local');
const url=process.env.RH_CATALOG_RPC_URL||e.TG_RPC_URL||`https://robinhood-mainnet.g.alchemy.com/v2/${e.ALCHEMY_API_KEY||t.ALCHEMY_API_KEY}`;
const c=createPublicClient({transport:http(url,{retryCount:2,timeout:30000,batch:{batchSize:40,wait:20}})});
const write=(name,v)=>fs.writeFileSync(path.join(out,name),JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
const read=n=>JSON.parse(fs.readFileSync(path.join(out,n),'utf8'));
const assets=read('raw/assets.json').assets.filter(a=>a.deployments.some(d=>d.chainId===4663));
const addresses=assets.map(a=>a.deployments.find(d=>d.chainId===4663).contractAddress.toLowerCase());
const chain=await c.getChainId();if(chain!==4663)throw new Error('Wrong chain');
const block=fs.existsSync(path.join(out,'raw/chain-snapshot.json'))?read('raw/chain-snapshot.json'):await c.getBlock({blockTag:'finalized'});
const bn=BigInt(block.number);if(!fs.existsSync(path.join(out,'raw/chain-snapshot.json')))write('raw/chain-snapshot.json',block);
console.log('snapshot',chain,String(bn));
const factories=[
 {version:'v2',address:'0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',event:'event PairCreated(address indexed token0,address indexed token1,address pair,uint256 pairIndex)',keys:['token0','token1']},
 {version:'v3',address:'0x1f7d7550b1b028f7571e69a784071f0205fd2efa',event:'event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)',keys:['token0','token1']},
 {version:'v4',address:'0x8366a39cc670b4001a1121b8f6a443a643e40951',event:'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',keys:['currency0','currency1']}
];
async function logs(f,key,lo,hi){
 try{return await c.getLogs({address:f.address,event:parseAbiItem(f.event),args:{[key]:addresses},fromBlock:lo,toBlock:hi});}
 catch(err){if(hi-lo<5000n)throw new Error('Log request failed: '+err.name);const mid=(lo+hi)/2n;return [...await logs(f,key,lo,mid),...await logs(f,key,mid+1n,hi)];}
}
for(const f of factories.filter(f=>!process.argv[3]||f.version===process.argv[3])){
 const file=`raw/${f.version}-stock-pool-events.json`;if(fs.existsSync(path.join(out,file)))continue;
 const all=[];
 for(const key of f.keys){
  for(let start=0n;start<=bn;start+=10000000n){
   const end=start+9999999n>bn?bn:start+9999999n;
   const found=await logs(f,key,start,end);all.push(...found.map(l=>({...l.args,blockNumber:l.blockNumber,blockHash:l.blockHash,transactionHash:l.transactionHash,logIndex:l.logIndex})));
   console.log(f.version,key,String(end),'events',found.length);
  }
 }
 const dedup=[...new Map(all.map(l=>[l.transactionHash+':'+l.logIndex,l])).values()];write(file,{factory:f.address,fromBlock:'0',toBlock:bn,events:dedup});console.log(f.version,'unique',dedup.length);
}
const abi=parseAbi(['function decimals() view returns (uint8)','function symbol() view returns (string)','function name() view returns (string)','function uid() view returns (bytes32)','function uiMultiplier() view returns (uint256)','function newUIMultiplier() view returns (uint256)','function effectiveAt() view returns (uint256)','function oraclePaused() view returns (bool)','function totalSupply() view returns (uint256)']);
if(!process.argv[3]&&!fs.existsSync(path.join(out,'raw/token-chain-state.json'))){
 const rows=[];
 for(let i=0;i<assets.length;i+=8){
  rows.push(...await Promise.all(assets.slice(i,i+8).map(async a=>{const address=a.deployments.find(d=>d.chainId===4663).contractAddress;const r={symbol:a.tokenSymbol,address};for(const method of ['decimals','symbol','name','uid','uiMultiplier','newUIMultiplier','effectiveAt','oraclePaused','totalSupply']){try{r[method]=await c.readContract({address,abi,functionName:method,blockNumber:bn})}catch(e){r[method]=null;r[method+'Error']=e.name}}
  const code=await c.getCode({address,blockNumber:bn});r.codeBytes=(code.length-2)/2;r.codeHash=keccak256(code);return r;})));console.log('tokens',rows.length);
 }write('raw/token-chain-state.json',rows);
}
