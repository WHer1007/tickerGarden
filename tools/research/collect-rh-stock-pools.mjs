// Fixed-block onchain state for stock/stock and stock/ETH,WETH,USDG pools.
import fs from 'node:fs';
import {parseAbi,keccak256} from '../../apps/web/node_modules/viem/_esm/index.js';
import {out,read,write,c,bn,chunks} from './rh-catalog-common.mjs';
const assets=read('raw/assets.json').assets;
const known=new Set(assets.flatMap(a=>a.deployments.filter(d=>d.chainId===4663).map(d=>d.contractAddress.toLowerCase())));
for(const a of ['0x0000000000000000000000000000000000000000','0x0bd7d308f8e1639fab988df18a8011f41eacad73','0x5fc5360d0400a0fd4f2af552add042d716f1d168'])known.add(a);
const abi=parseAbi(['function token0() view returns (address)','function token1() view returns (address)','function factory() view returns (address)','function liquidity() view returns (uint128)','function fee() view returns (uint24)','function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)','function getReserves() view returns (uint112,uint112,uint32)','function balanceOf(address) view returns (uint256)','function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)','function getLiquidity(bytes32) view returns (uint128)']);
for(const version of ['v2','v3','v4']){
 const input=`raw/${version}-stock-pool-events.json`,file=`raw/${version}-pool-state.json`;
 if(!fs.existsSync(`${out}/${input}`)||fs.existsSync(`${out}/${file}`))continue;
 const all=read(input).events;
 const pools=all.filter(p=>known.has((p.token0||p.currency0).toLowerCase())&&known.has((p.token1||p.currency1).toLowerCase()));
 console.log(version,'core pairs',pools.length);
 if(version==='v4'){
  const all=[];const state='0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
  for(let i=0;i<pools.length;i+=150){
   const part=pools.slice(i,i+150),contracts=part.flatMap(p=>[{address:state,abi,functionName:'getSlot0',args:[p.id]},{address:state,abi,functionName:'getLiquidity',args:[p.id]}]);
   const data=await c.multicall({contracts,multicallAddress:'0xca11bde05977b3631167028862be2a173976ca11',blockNumber:bn,allowFailure:true,batchSize:0});
   all.push(...part.map((p,j)=>({...p,version,slot0:data[j*2].status==='success'?data[j*2].result:null,activeLiquidity:data[j*2+1].status==='success'?data[j*2+1].result:null,reservesStatus:'NOT_MEASURED_SINGLETON_BALANCE_NOT_POOL_TVL'})));
   console.log('v4 batch',all.length,'/',pools.length);
  }
  write(file,all);continue;
 }
 const result=await chunks(pools,async p=>{
  const r={...p,version};const address=p.pool||p.pair;
  async function get(a,method,args=[]){try{return await c.readContract({address:a,abi,functionName:method,args,blockNumber:bn})}catch(e){r[method+'Error']=e.name;return null}}
  if(version==='v4'){
   r.slot0=await get('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b','getSlot0',[p.id]);
   r.activeLiquidity=await get('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b','getLiquidity',[p.id]);
   r.reserve0=null;r.reserve1=null;r.reservesStatus='NOT_MEASURED_SINGLETON_BALANCE_NOT_POOL_TVL';
  }else{
   r.verifiedToken0=await get(address,'token0');r.verifiedToken1=await get(address,'token1');r.verifiedFactory=await get(address,'factory');
   if(version==='v2'){r.reserves=await get(address,'getReserves');r.fee=3000;}
   else {r.slot0=await get(address,'slot0');r.activeLiquidity=await get(address,'liquidity');r.verifiedFee=await get(address,'fee');}
   r.balance0=await get(p.token0,'balanceOf',[address]);r.balance1=await get(p.token1,'balanceOf',[address]);
  }
  return r;
 });write(file,result);
}
