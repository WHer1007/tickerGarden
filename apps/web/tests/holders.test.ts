import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateHolderPage} from '../src/v1/holders.ts';
const id={marketId:`0x${'1'.repeat(64)}` as `0x${string}`,memeToken:`0x${'2'.repeat(40)}`};
const account=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
function fixture(){return{chainId:4663,displayOnly:true,...id,creationBlockNumber:'1',sourceBlockNumber:'10',sourceBlockHash:id.marketId,finality:'finalized',exclusionPolicy:'KNOWN_PROTOCOL_ADDRESSES_V1',totalSupplyRaw:'30',positiveAddressCount:2,includedAddressCount:1,excludedAccounts:[account(1)],balances:[{account:account(1),balanceRaw:'10',excluded:true},{account:account(2),balanceRaw:'20',excluded:false}],revision:'sha256:'+'1'.repeat(64),nextCursor:null as string|null};}
test('holder pages enforce full snapshot counts and supply across pagination',()=>{
 const all=fixture();assert.equal(validateHolderPage(all,4663,id,50).balances.length,2);
 const first=fixture();first.balances=first.balances.slice(0,1);first.nextCursor='next';const prior=validateHolderPage(first,4663,id,1);
 const last=fixture();last.balances=last.balances.slice(1);assert.equal(validateHolderPage(last,4663,id,1,prior).nextCursor,null);
 last.sourceBlockNumber='11';assert.throws(()=>validateHolderPage(last,4663,id,1,prior));
 const duplicate=fixture();duplicate.balances=duplicate.balances.slice(0,1);assert.throws(()=>validateHolderPage(duplicate,4663,id,1,prior));
});
test('holder validation rejects misleading balances counts exclusions and identity',()=>{
 const mutations:Array<(p:ReturnType<typeof fixture>)=>void>=[p=>{p.chainId=1},p=>{p.sourceBlockHash='0xbad'},p=>{p.finality='head'},p=>{p.totalSupplyRaw='29'},p=>{p.balances[0]!.balanceRaw='0'},p=>{p.balances[0]!.balanceRaw='01'},p=>{p.balances[0]!.excluded=false},p=>{p.excludedAccounts=[]},p=>{p.positiveAddressCount=3},p=>{p.includedAddressCount=2},p=>{p.creationBlockNumber='11'},p=>{p.balances.reverse()},p=>{p.nextCursor='next'},p=>{p.totalSupplyRaw=(1n<<256n).toString()}];
 for(const mutate of mutations){const p=fixture();mutate(p);assert.throws(()=>validateHolderPage(p,4663,id,50));}
});
test('empty holder snapshot is valid only with zero supply and counts',()=>{
 const p=fixture();p.balances=[];p.totalSupplyRaw='0';p.positiveAddressCount=0;p.includedAddressCount=0;
 assert.equal(validateHolderPage(p,4663,id,50).balances.length,0);
 p.totalSupplyRaw='1';assert.throws(()=>validateHolderPage(p,4663,id,50));
});
