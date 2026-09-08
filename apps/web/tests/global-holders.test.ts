import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateGlobalHolders} from '../src/v1/globalHolders.ts';
const hash=(n:number)=>'0x'+n.toString(16).padStart(64,'0'),address=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
function fixture(){return{chainId:4663,displayOnly:true,finality:'finalized',sourceBlockNumber:'123',sourceBlockHash:hash(123),marketCount:3,positiveMarketAddressPairs:6,positiveAddressCount:4,includedAddressCount:3,exclusionPolicy:'UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1',excludedAccounts:[address(3)],groups:[{assetUid:hash(1),binding:'registered_stock',marketCount:2,positiveMarketAddressPairs:4,positiveAddressCount:3,includedAddressCount:2},{assetUid:hash(2),binding:'registered_stock',marketCount:1,positiveMarketAddressPairs:2,positiveAddressCount:2,includedAddressCount:2}]};}
test('global holders preserve overlapping groups and explicit exclusions',()=>{
 const p=validateGlobalHolders(fixture(),4663);assert.equal(p.positiveAddressCount,4);assert.equal(p.groups.reduce((n,g)=>n+g.positiveAddressCount,0),5);
 const unbound=fixture();unbound.groups[0]!.assetUid=hash(0);unbound.groups[0]!.binding='unbound';assert.equal(validateGlobalHolders(unbound,4663).groups[0]!.binding,'unbound');
});
test('global holders reject inconsistent snapshots and impossible count relationships',()=>{
 const mutations:Array<(p:ReturnType<typeof fixture>)=>void>=[p=>{p.chainId=1},p=>{p.finality='pending'},p=>{p.displayOnly=false},p=>{p.sourceBlockNumber='01'},p=>{p.sourceBlockNumber='9223372036854775808'},p=>{p.sourceBlockHash='bad'},p=>{p.marketCount=4},p=>{p.positiveMarketAddressPairs=7},p=>{p.positiveAddressCount=7},p=>{p.includedAddressCount=5},p=>{p.excludedAccounts=[]},p=>{p.excludedAccounts.push(address(3))},p=>{p.excludedAccounts=[address(4),address(3)]},p=>{p.excludedAccounts=[address(0)]},p=>{p.groups.reverse()},p=>{p.groups[0]!.binding='unbound'},p=>{p.groups[1]!.assetUid=hash(1)},p=>{p.groups[1]!.positiveMarketAddressPairs=3;p.positiveMarketAddressPairs=7},p=>{p.groups[1]!.includedAddressCount=-1},p=>{p.exclusionPolicy='unknown'},p=>{p.groups[0]!.marketCount=1.5}];
 for(const mutate of mutations){const p=fixture();mutate(p);assert.throws(()=>validateGlobalHolders(p,4663));}
 assert.throws(()=>validateGlobalHolders(null,4663));
});
test('global holders accept empty markets and fully burned supply as verified zero',()=>{
 const p=fixture();p.groups=[];p.marketCount=0;p.positiveMarketAddressPairs=0;p.positiveAddressCount=0;p.includedAddressCount=0;p.excludedAccounts=[];assert.equal(validateGlobalHolders(p,4663).marketCount,0);
 p.marketCount=1;p.groups=[{assetUid:hash(1),binding:'registered_stock',marketCount:1,positiveMarketAddressPairs:0,positiveAddressCount:0,includedAddressCount:0}];p.excludedAccounts=[address(3)];assert.equal(validateGlobalHolders(p,4663).positiveAddressCount,0);
});
