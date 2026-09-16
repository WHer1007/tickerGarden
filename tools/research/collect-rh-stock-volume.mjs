// Fixed-block 24h swap observations. USD valuation is added separately using snapshot reference prices.
import fs from 'node:fs';
import {parseAbiItem} from '../../apps/web/node_modules/viem/_esm/index.js';
import {out,read,write,c,bn} from './rh-catalog-common.mjs';
const snapshot=read('raw/chain-snapshot.json'),target=BigInt(snapshot.timestamp)-86400n;
let lo=bn>1500000n?bn-1500000n:0n,hi=bn;
while(lo<hi){let mid=(lo+hi)/2n;let b=await c.getBlock({blockNumber:mid});if(b.timestamp<target)lo=mid+1n;else hi=mid;}
const first=await c.getBlock({blockNumber:lo});
for(const version of ['v2','v3','v4'].filter(v=>!process.argv[3]||process.argv[3]===v)){
 const input=`raw/${version}-pool-state.json`,file=`raw/${version}-swaps-24h.json`;
 if(!fs.existsSync(`${out}/${input}`)||fs.existsSync(`${out}/${file}`))continue;
 const pools=read(input),events=[];
 const event=parseAbiItem(version==='v2'?'event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)':version==='v3'?'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)':'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
 async function get(group,fromBlock,toBlock){try{return await c.getLogs({address:version==='v4'?'0x8366a39cc670b4001a1121b8f6a443a643e40951':group.map(p=>p.pool||p.pair),event,args:version==='v4'?{id:group.map(p=>p.id)}:undefined,fromBlock,toBlock})}catch(e){console.log('split',version,String(fromBlock),String(toBlock),e.name);if(toBlock-fromBlock<5000n)throw new Error('Swap collection failed: '+e.name);const m=(fromBlock+toBlock)/2n;return [...await get(group,fromBlock,m),...await get(group,m+1n,toBlock)];}}
 for(let i=0;i<pools.length;i+=5){const l=await get(pools.slice(i,i+5),lo,bn);events.push(...l.map(x=>({pool:version==='v4'?x.args.id:x.address,...x.args,blockNumber:x.blockNumber,transactionHash:x.transactionHash,logIndex:x.logIndex})));console.log(version,'pools',i+5,'swaps',events.length);}
 write(file,{fromBlock:lo,toBlock:bn,fromTimestamp:first.timestamp,toTimestamp:snapshot.timestamp,events});
}
