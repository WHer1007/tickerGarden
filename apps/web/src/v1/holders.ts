import type {MarketHoldersResponse} from './generated/read-api.ts';
export type HolderIdentity={marketId:`0x${string}`;memeToken:string};
const hash=/^0x[0-9a-f]{64}$/;const address=/^0x[0-9a-f]{40}$/;const integer=/^(0|[1-9][0-9]*)$/;
const zero='0x'+'0'.repeat(40);
function raw(v:unknown):bigint{if(typeof v!=='string'||v.length>78||!integer.test(v))throw new Error('Invalid holder integer');const n=BigInt(v);if(n>=(1n<<256n))throw new Error('Holder integer overflow');return n;}
function count(v:unknown):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new Error('Invalid address count');return v;}
export function validateHolderPage(value:unknown,chain:number,id:HolderIdentity,limit:number,prior:MarketHoldersResponse|null=null):MarketHoldersResponse{
 const p=value as MarketHoldersResponse;
 const fail=():never=>{throw new Error('Invalid holder snapshot');};
 if(!p||p.chainId!==chain||p.displayOnly!==true||p.marketId!==id.marketId||p.memeToken!==id.memeToken||!hash.test(p.marketId)||!address.test(p.memeToken)||p.memeToken===zero||p.finality!=='finalized'||p.exclusionPolicy!=='KNOWN_PROTOCOL_ADDRESSES_V1'||!hash.test(p.sourceBlockHash)||typeof p.revision!=='string'||!/^sha256:[0-9a-f]{64}$/.test(p.revision))fail();
 if(!Number.isInteger(limit)||limit<1||limit>100||!Array.isArray(p.balances)||p.balances.length>limit||!Array.isArray(p.excludedAccounts)||p.excludedAccounts.length>1000)fail();
 const supply=raw(p.totalSupplyRaw);const creation=raw(p.creationBlockNumber);const source=raw(p.sourceBlockNumber);if(creation>source||source>=(1n<<64n))fail();
 const total=count(p.positiveAddressCount),included=count(p.includedAddressCount);if(included>total)fail();
 if(p.nextCursor!==null&&(typeof p.nextCursor!=='string'||p.nextCursor.length===0||p.nextCursor.length>2048||p.balances.length!==limit))fail();
 const exclusions=new Set<string>();let last='';for(const a of p.excludedAccounts){if(typeof a!=='string'||!address.test(a)||a===zero||a<=last)fail();exclusions.add(a);last=a;}
 if(prior){
  if(!prior.nextCursor||prior.nextCursor===p.nextCursor)fail();
  for(const k of ['chainId','marketId','memeToken','creationBlockNumber','sourceBlockNumber','sourceBlockHash','finality','exclusionPolicy','totalSupplyRaw','positiveAddressCount','includedAddressCount','revision'] as const){if(prior[k]!==p[k])fail();}
  if(JSON.stringify(prior.excludedAccounts)!==JSON.stringify(p.excludedAccounts))fail();
 }
 const all=[...(prior?.balances??[]),...p.balances];last='';let sum=0n,observedIncluded=0;
 for(const b of all){if(!b||typeof b.account!=='string'||!address.test(b.account)||b.account===zero||b.account<=last||typeof b.excluded!=='boolean'||b.excluded!==exclusions.has(b.account))fail();last=b.account;const n=raw(b.balanceRaw);if(n===0n)fail();sum+=n;if(!b.excluded)observedIncluded++;}
 if(sum>supply||all.length>total||observedIncluded>included||all.length-observedIncluded>total-included)fail();
 if(p.nextCursor===null&&(sum!==supply||all.length!==total||observedIncluded!==included))fail();
 if(p.nextCursor!==null&&all.length>=total)fail();
 return p;
}
