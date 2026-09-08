import type {GlobalHolderCountsResponse} from './generated/read-api.ts';
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const zero='0x'+'0'.repeat(64);
export function validateGlobalHolders(value:unknown,chain:number):GlobalHolderCountsResponse{
 const p=value as GlobalHolderCountsResponse;
 const fail=():never=>{throw new Error('Global holder snapshot is inconsistent');};
 if(!p||p.chainId!==chain||p.displayOnly!==true||p.finality!=='finalized'||!hash(p.sourceBlockHash)||typeof p.sourceBlockNumber!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(p.sourceBlockNumber)||BigInt(p.sourceBlockNumber)>9223372036854775807n||p.exclusionPolicy!=='UNION_OF_KNOWN_PROTOCOL_ADDRESSES_V1')fail();
 const validCounts=(g:{marketCount:number;positiveMarketAddressPairs:number;positiveAddressCount:number;includedAddressCount:number})=>[g.marketCount,g.positiveMarketAddressPairs,g.positiveAddressCount,g.includedAddressCount].every(count)&&g.marketCount<=1000&&g.positiveMarketAddressPairs<=1000000&&g.includedAddressCount<=g.positiveAddressCount&&g.positiveAddressCount<=g.positiveMarketAddressPairs&&g.positiveMarketAddressPairs<=g.marketCount*g.positiveAddressCount;
 if(!validCounts(p)||!Array.isArray(p.groups)||p.groups.length>1000||!Array.isArray(p.excludedAccounts)||p.excludedAccounts.length>1000000)fail();
 let previous='';for(const a of p.excludedAccounts){if(typeof a!=='string'||!/^0x[0-9a-f]{40}$/.test(a)||a==='0x'+'0'.repeat(40)||a<=previous)fail();previous=a;}
 let markets=0,pairs=0,positive=0,included=0;previous='';
 for(const g of p.groups){
  if(!g||!hash(g.assetUid)||g.assetUid<=previous||!validCounts(g)||g.marketCount===0||(g.assetUid===zero?g.binding!=='unbound':g.binding!=='registered_stock')||g.positiveAddressCount>p.positiveAddressCount||g.includedAddressCount>p.includedAddressCount||g.positiveAddressCount-g.includedAddressCount>p.excludedAccounts.length)fail();
  previous=g.assetUid;markets+=g.marketCount;pairs+=g.positiveMarketAddressPairs;positive+=g.positiveAddressCount;included+=g.includedAddressCount;
 }
 if(markets!==p.marketCount||pairs!==p.positiveMarketAddressPairs||positive<p.positiveAddressCount||included<p.includedAddressCount||p.positiveAddressCount-p.includedAddressCount>p.excludedAccounts.length||(p.marketCount===0&&p.excludedAccounts.length!==0))fail();
 return p;
}
