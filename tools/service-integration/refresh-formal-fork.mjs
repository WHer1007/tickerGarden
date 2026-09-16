import fs from 'node:fs';
import {encodeFunctionData,parseAbi} from '../../apps/web/node_modules/viem/_esm/index.js';
const file='contracts/test/v1/fork/FormalClockArbitrumFork.t.sol',out='outputs/reviews/formal-clock-service-integration-2026-09-06',rpc='https://sepolia-rollup.arbitrum.io/rpc';
const prior=fs.readFileSync(file,'utf8');if(!fs.existsSync(out+'/formal-fork-before.sol'))fs.writeFileSync(out+'/formal-fork-before.sol',prior);
async function read(method,params){const x=await(await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})).json();if(x.error)throw Error('RPC read failed');return x.result;}
const chain=await read('eth_chainId',[]),h=await read('eth_getBlockByNumber',['latest',false]);if(BigInt(chain)!==421614n)throw Error('Wrongchain');
const observed=await read('eth_getBlockByNumber',[h.number,false]);if(observed.hash!==h.hash)throw Error('Unstable anchor');
const source=await read('eth_getBlockByNumber',['0x'+(BigInt(h.number)-2n).toString(16),false]);
const actual=await read('eth_call',[{to:'0x0000000000000000000000000000000000000064',data:encodeFunctionData({abi:parseAbi(['function arbBlockHash(uint256) view returns (bytes32)']),functionName:'arbBlockHash',args:[BigInt(source.number)]})},{blockHash:h.hash,requireCanonical:true}]);if(actual!==source.hash)throw Error('Live Nitro source hash mismatch');
fs.writeFileSync(file,prior.replace(/FORK_SOURCE_BLOCK_HASH = [^;]+/,`FORK_SOURCE_BLOCK_HASH = ${source.hash}`).replace(/FORK_BLOCK_NUMBER = \d+/,`FORK_BLOCK_NUMBER = ${BigInt(h.number)}`).replace(/FORK_BLOCK_HASH = 0x[0-9a-f]+/,`FORK_BLOCK_HASH = ${h.hash}`));
fs.writeFileSync(out+'/formal-fork-fresh-anchor.json',JSON.stringify({rpc,chainId:421614,blockNumber:String(BigInt(h.number)),blockHash:h.hash,sourceBlockNumber:String(BigInt(source.number)),sourceBlockHash:source.hash,liveArbSysHash:actual,at:new Date().toISOString(),reason:'Prior pinned archive state unavailable; only test anchor refreshed'},null,2));
console.log(String(BigInt(h.number)));
