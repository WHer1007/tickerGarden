// Core liquidity principal only; never equate singleton balances with per-pool TVL.
import {parseAbi,keccak256} from '../../apps/web/node_modules/viem/_esm/index.js';
import {read,write,c,bn,chunks} from './rh-catalog-common.mjs';
const address='0x0000001b173c3bbf3984d417d8614e3eed34865b',manager='0x8366a39cc670b4001a1121b8f6a443a643e40951';
const resultType='(uint256 coreAmount0,uint256 coreAmount1,uint256 hookReserves0,uint256 hookReserves1,uint256 hookEffective0,uint256 hookEffective1,uint160 sqrtPriceX96,int24 tick,uint128 activeLiquidity,uint256 blockNumber,address statsProvider,uint16 hookPermissions,bool hasCustomAccounting,uint8 statsStatus)';
const keyType='(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const abi=parseAbi([`function getPoolTVL(address manager,${keyType} key) view returns (${resultType} result)`,`function getPoolTVLPaged(address manager,${keyType} key,bytes cursor) view returns (${resultType} result,bytes nextCursor,bool done)`,`function getPoolTVLBatch(address manager,${keyType}[] keys) view returns (${resultType}[] results)`]);
const code=await c.getCode({address,blockNumber:bn});
const pools=read('raw/v4-pool-state.json');
if(!code||code==='0x'){write('raw/v4-reserves.json',{status:'LENS_NOT_DEPLOYED_AT_SNAPSHOT',pools:[]});process.exit(0)}
const active=pools.filter(p=>BigInt(p.activeLiquidity||0)>0n);
const keyOf=p=>({currency0:p.currency0,currency1:p.currency1,fee:p.fee,tickSpacing:p.tickSpacing,hooks:p.hooks});
async function batch(part){
 try{const r=await c.readContract({address,abi,functionName:'getPoolTVLBatch',args:[manager,part.map(keyOf)],blockNumber:bn,gas:30000000n});return part.map((p,i)=>({id:p.id,status:'COMPLETE',result:r[i]}));}
 catch(e){if(part.length===1)return [{id:part[0].id,status:'UNAVAILABLE',errorName:e.name}];let m=Math.floor(part.length/2);return [...await batch(part.slice(0,m)),...await batch(part.slice(m))];}
}
const regular=active.filter(p=>p.tickSpacing>1),results=[];
for(let i=0;i<regular.length;i+=15){results.push(...await batch(regular.slice(i,i+15)));if(i%150===0)console.log('TVL',results.length,'/',regular.length);}
results.push(...await chunks(active.filter(p=>p.tickSpacing===1),async p=>{
 const key={currency0:p.currency0,currency1:p.currency1,fee:p.fee,tickSpacing:p.tickSpacing,hooks:p.hooks};const r={id:p.id};
 try{
  if(p.tickSpacing>1)r.result=await c.readContract({address,abi,functionName:'getPoolTVL',args:[manager,key],blockNumber:bn,gas:30000000n});
  else{let cursor='0x',done=false;for(let page=0;page<64&&!done;page++){let v=await c.readContract({address,abi,functionName:'getPoolTVLPaged',args:[manager,key,cursor],blockNumber:bn,gas:12000000n});[r.result,cursor,done]=v;r.pages=page+1;}if(!done)return {...r,status:'INCOMPLETE_NOT_TVL',result:null};}
  r.status='COMPLETE';
 }catch(e){r.status='UNAVAILABLE';r.errorName=e.name;}
 return r;
},4));
write('raw/v4-reserves.json',{lens:address,codeHash:keccak256(code),block:bn,pools:results});
