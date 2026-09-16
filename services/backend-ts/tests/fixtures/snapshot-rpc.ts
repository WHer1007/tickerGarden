import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {decodeFunctionData,encodeFunctionResult,type Abi,type Address,type Hex} from 'viem';
import {RpcTransport,type RpcBlock} from '../../packages/chain/src/index.ts';
import {CURRENT_RELEASE_ID,CURRENT_ACTIVATION_BLOCK,fixedF72Sources} from '../../packages/events/src/index.ts';
import {snapshotAbis} from '../../packages/events/src/f72-abis.generated.ts';
import {buildSnapshot,SNAPSHOT_MODE} from '../../packages/chain/src/holder-snapshot.ts';
import {snapshotDistributor} from '../../packages/chain-worker/src/holder-snapshots.ts';
export const h=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as Hex,a=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as Address;
export const height=CURRENT_ACTIVATION_BLOCK+100n;
const combined=[...snapshotAbis.HolderRewardsDistributorV1,...snapshotAbis.TickerMemeTokenV1] as Abi;
export function fixture(){return buildSnapshot({chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,distributor:snapshotDistributor(),marketId:h(2),token:a(2),quote:a(0),round:'1',snapshotBlock:height.toString(),snapshotBlockHash:h(3),registeredBlock:CURRENT_ACTIVATION_BLOCK.toString(),lastSnapshotBlock:'0',totalSupply:'6',quoteAvailable:'101',memeAvailable:'0',burnMemeFees:false,exclusions:[a(0),snapshotDistributor(),a(2)],balances:[{account:a(11),balance:'1'},{account:a(12),balance:'2'},{account:a(13),balance:'3'}]});}
export class FakeRpc extends RpcTransport {
 lastRound=0n;publisher=a(99);badBalance=false;underfunded=false;root=h(0);dataHash=h(0);badChain=false;orphan=false;simulations=0;
 constructor(){super({url:'http://localhost:8545'});}
 override async block(number:bigint):Promise<RpcBlock>{return {number,hash:number===height?(this.orphan?h(8):h(3)):h(4),parentHash:h(1),timestamp:100000n};}
 override async codeHash(address:Hex,_number:bigint){return fixedF72Sources().find(s=>s.address===address)!.runtimeCodeHash;}
 override async call<T>(method:string,params:readonly unknown[]):Promise<T>{
  if(method==='eth_chainId')return (this.badChain?'0x1':'0xb626') as T;
  if(method==='eth_getBlockByNumber')return {number:`0x${(height+1000n).toString(16)}`} as T;
  if(method==='eth_call'){const data=(params[0] as {data:Hex}).data;assert.equal(decodeFunctionData({abi:combined,data}).functionName,'publishSnapshots');this.simulations++;return '0x' as T;}
  throw Error('unexpected RPC method');
 }
 override async callAt(_target:Address,data:Hex,block:bigint):Promise<Hex>{
  const call=decodeFunctionData({abi:combined,data});const f=call.functionName;let result:unknown;
  if(f==='rewardMode')result=SNAPSHOT_MODE;
  else if(f==='snapshotPublisher')result=this.publisher;
  else if(f==='marketState')result={token:a(2),quote:a(0),vault:a(8),registeredBlock:CURRENT_ACTIVATION_BLOCK,lastRound:block>height?this.lastRound:0n,lastSnapshotBlock:0n,unallocatedQuote:this.underfunded&&block>height?1n:101n,unallocatedMeme:0n,burnMemeFees:false};
  else if(f==='feeSharingExcludedAccounts')result=[a(0),snapshotDistributor(),a(2)];
  else if(f==='totalSupply')result=6n;
  else if(f==='balanceOf')result=this.badBalance?0n:BigInt(String(call.args![0]))-10n;
  else if(f==='roundState')result={root:this.root,snapshotBlockHash:h(3),dataHash:this.dataHash,snapshotBlock:height,quoteBudget:99n,memeBudget:0n,quoteRemaining:99n,memeRemaining:0n};
  else throw Error('unexpected read '+f);
  return encodeFunctionResult({abi:combined,functionName:f,result});
 }
}
