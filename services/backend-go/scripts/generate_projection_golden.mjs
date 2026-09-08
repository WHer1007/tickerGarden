// TypeScript is a test oracle only; production has no Node dependency.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyV1Event } from '../testsupport/projection/projector.ts';
import { createIndexerState } from '../testsupport/projection/schema.ts';
const root=new URL('../',import.meta.url);
const catalog=JSON.parse(readFileSync(new URL('internal/events/catalog.json',root)));
const id=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const address=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const defaults={assetUid:id(1),marketId:id(2),poolId:id(3),id:id(3),baselineId:id(4),tickerGardenBaselineId:id(4),configId:id(5),quoteAssetConfigId:id(5),launchTemplateId:id(6),feeId:id(7),curve:address(3),memeToken:address(4),gauge:address(5),quoteAsset:address(6),feeAsset:address(6),user:address(2)};
const state=createIndexerState(),cases=[];
// TS provenance uses a runtime spread of its event argument, retaining undeclared
// args/signature/observations. Compare the declared Provenance schema, not those
// incidental extra properties (the event fact still compares args/signature).
const provenanceFields=['chainId','blockNumber','blockHash','transactionHash','transactionIndex','logIndex','emitter','eventKey'];
const canonical=(v)=>{
 if(Array.isArray(v))return v.map(canonical);
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,value])=>[k,
  (k==='provenance'||k==='lastPosition')?Object.fromEntries(provenanceFields.map(f=>[f,value[f]])):canonical(value)]));
 return v;
};
function add(name,overrides={},observations=[]) {
 const d=catalog.events.find(d=>d.name===name);if(!d)throw new Error(name);
 const args={};for(const p of d.inputs)args[p.name]=overrides[p.name]??defaults[p.name]??(p.type==='bool'?false:p.type==='address'?address(8):p.type==='bytes32'?id(9):p.type.startsWith('int')?-10n:1n);
 const index=cases.length;
 const event={chainId:46630,blockNumber:10n,blockHash:id(10),transactionHash:id(11),transactionIndex:0,logIndex:index,emitter:d.modules.includes('TickerGardenCurve')?address(3):address(8),signature:d.signature,args,observations};
 const word=p=>{const v=args[p.name];if(p.type==='address'||p.type==='bytes32')return v.slice(2).padStart(64,'0');const n=p.type==='bool'?(v?1n:0n):BigInt(v);return(n<0n?(1n<<256n)+n:n).toString(16).padStart(64,'0');};
 const log={address:event.emitter,topics:[d.topic0,...d.inputs.filter(p=>p.indexed).map(p=>'0x'+word(p))],data:'0x'+d.inputs.filter(p=>!p.indexed).map(word).join(''),blockNumber:'0xa',blockHash:event.blockHash,transactionHash:event.transactionHash,transactionIndex:'0x0',logIndex:'0x'+index.toString(16),removed:false};
 applyV1Event(state,event);
 const tables=Object.fromEntries(Object.entries(state).filter(([,v])=>v instanceof Map).map(([k,v])=>[k,Object.fromEntries(v)]));
 cases.push(JSON.parse(JSON.stringify({name,input:{chainId:event.chainId,module:d.modules[0],log,observations},expected:canonical({tables,lastPosition:state.lastPosition})},(_,v)=>typeof v==='bigint'?v.toString():v)));
}
add('AssetRegistered',{},[{kind:'asset',key:id(1),value:{minimumAllocation:414n,tokenDecimals:18n}}]);
add('QuoteAssetConfigAdded');add('MarketRegistered');
for(const d of catalog.events){if(d.name==='V4FeeAccrued')add('Swap');add(d.name);}
add('RewardConverted',{creatorEpoch:0n});
add('FeeClaimed',{amount:(1n<<256n)-1n});
add('FeeClaimed',{amount:(1n<<256n)-1n});
add('FeeClaimed',{beneficiaryType:0n,beneficiaryEpoch:2n,feeAsset:address(0)});
add('RageQuitRewardSettlementQueued');add('RageQuitRewardSettlementDeferred');add('RageQuitRewardSettlementFinalized');
add('TickerGardenBaselineAdded',{},[{kind:'baseline',key:id(4),value:{sellbackFloorBps:1n}}]);
add('LaunchTemplateAdded',{},[{kind:'template',key:id(6),value:{tickSpacing:60n}}]);
add('MarketCreated',{},[{kind:'market',key:id(2),value:{stakingEnabled:true}},{kind:'poolKey',key:id(3),value:{currency0:address(4)}},{kind:'vaultPosition',key:id(1)+':'+address(2),value:{totalStock:100n}},{kind:'gaugePosition',key:address(2)+':'+id(2),value:{allocated:'10'}}]);
add('Transfer',{value:(1n<<256n)-1n});
add('Swap');add('Swap');
add('V4FeeAccrued',{feeId:id(99),feeNonce:2n});
add('V4FeeAccrued',{feeId:id(100),feeNonce:3n});
add('QuoteAssetIdentityPinned',{},[{kind:'quote',key:id(5),value:{status:1n}},{kind:'assetIdentity',key:id(1),value:{runtimeCodeHash:id(55)}},{kind:'curve',key:address(3),value:{quoteReserve:(1n<<256n)-1n}},{kind:'vaultSolvency',key:id(1),value:{solvent:true}},{kind:'liability',key:id(2),value:{total:'0'}}]);
const output=new URL('internal/projection/testdata/golden.json',root),data=JSON.stringify(cases)+'\n';
if(process.argv.includes('--check')){if(readFileSync(output,'utf8')!==data)throw new Error('projection golden drift');}
else{mkdirSync(fileURLToPath(new URL('.',output)),{recursive:true});writeFileSync(output,data);}
