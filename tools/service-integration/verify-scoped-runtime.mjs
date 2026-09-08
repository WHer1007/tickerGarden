import fs from 'node:fs/promises';
import {keccak256} from '../../apps/web/node_modules/viem/_esm/index.js';
const dir=new URL('../../outputs/reviews/frontend-integration-repair-2026-09-08/',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',dir)));
async function rpc(method,params){const r=await fetch('http://127.0.0.1:18570',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('scoped RPC unavailable');const x=await r.json();if(x.error||x.result==null)throw Error('scoped RPC rejected');return x.result;}
try{
 const chain=await rpc('eth_chainId',[]);if(Number(BigInt(chain))!==manifest.chainId)throw Error('wrong chain');
 const head=await rpc('eth_getBlockByNumber',['finalized',false]);
 const contracts=[];
 for(const c of manifest.contracts){const code=await rpc('eth_getCode',[c.address,{blockHash:head.hash,requireCanonical:true}]);contracts.push({module:c.module,address:c.address,matches:keccak256(code)===c.runtimeCodeHash});}
 const fence=await rpc('eth_getBlockByNumber',[head.number,false]);
 const pass=contracts.every(x=>x.matches)&&fence.hash===head.hash;
 const result={at:new Date().toISOString(),chainId:manifest.chainId,blockNumber:Number(BigInt(head.number)),blockHash:head.hash,pass,contracts,transactionSubmission:false};
 await fs.writeFile(new URL('scoped-runtime-check.json',dir),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({pass,contracts:contracts.length,blockNumber:result.blockNumber}));if(!pass)process.exitCode=1;
}catch{console.error('Scoped runtime verification failed; no transaction submitted');process.exitCode=1;}
