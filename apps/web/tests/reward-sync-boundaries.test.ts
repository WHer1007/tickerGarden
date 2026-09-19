import {RewardClaimError} from '../src/ui/reward-error.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
function run(code:string,context:Record<string,unknown>){return vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,context);}

test('Holder search loads a published market without sending the display head revision',async()=>{
 const code=source.slice(source.indexOf('async function selectHolderSearchResult('),source.indexOf('const creatorMarketIds='));
 const item={marketId:'market',memeToken:'token',symbol:'SEED'};let refreshed=false;
 const context={routeGeneration:1,foundation:{markets:[],sync:{revision:'head:100'}},readApi:{getMarket:async(args:any)=>{assert.equal(args.revision,undefined);return {market:item,sync:{revision:'finalized:90'}};}},assertFinalizedSync:(sync:any,revision:any)=>{assert.equal(sync.revision,'finalized:90');assert.equal(revision,undefined);},query:()=>({replaceChildren(){},value:''}),Option:class{},rememberHolderMarket(){},refreshTreasuryReward:async()=>{refreshed=true;},item,input:{isConnected:true,setAttribute(){}},results:{replaceChildren(){}}};
 await run(code+'\nselectHolderSearchResult(item,input,results)',context);assert.equal(refreshed,true);
});

async function holderClaim(overrides:Record<string,unknown>={}){
 const start=source.indexOf('    const verify=async()=>{',source.indexOf('async function executeSnapshotClaim'));
 const end=source.indexOf('    // Receipt confirmation',start);
 const round={root:'root',snapshotBlock:10n,quoteAmount:5n,memeAmount:2n,round:1n};
 const state={market:{}};const wallet={};const id={marketId:'market',distributor:'distributor',account:'account'};
 let submitted=false;const block={number:200n,hash:'canonical'};
 const context={RewardClaimError,snapshotReward:state,state,round,selectedSnapshotRound:()=>round,wallet,activeWallet:wallet,verifyLiveWalletContext:async()=>{},ensureCanonicalMarket:async()=>{},marketRelease:()=>({holderDistributor:id.distributor}),id,assets:3,WALLET_SNAPSHOT_MODE:'mode',currentV4Abis_HolderRewardsDistributorV1:[],robinhoodChain:{id:4663},foundation:{sync:{status:'unavailable',revision:'old'}},publicClient:{getBlock:async()=>block,readContract:async(args:any)=>{assert.equal(args.blockNumber,200n);return args.functionName==='rewardMode'?'mode':args.functionName==='claimedAssets'?(overrides.claimed??0):{...round,quoteRemaining:5n,memeRemaining:2n,...overrides};}},buildSnapshotClaim:()=>({}),executeTransaction:async(args:any)=>{assert.equal(args.sync.status,'synced');assert.equal(args.sync.revision,'200:canonical');await args.verifyChain();submitted=true;}};
 await run('(async()=>{'+source.slice(start,end)+'})()',context);return submitted;
}
test('Holder claim uses a live pinned block despite unavailable page sync',async()=>assert.equal(await holderClaim(),true));
for(const [label,change] of Object.entries({root:{root:'changed'},snapshot:{snapshotBlock:11n},duplicate:{claimed:1},quoteFunds:{quoteRemaining:4n},memeFunds:{memeRemaining:1n}}))test(`Holder still rejects invalid ${label}`,async()=>{await assert.rejects(holderClaim(change),/Reward state changed/);});
test('Creator zero DB balance does not disable an owned reward period',()=>{
 const start=source.indexOf('  if (creatorReward) {',source.indexOf('function updateRewardsAvailability'));
 const end=source.indexOf('  if (treasuryReward',start);
 for(const owned of [true,false]){let disabled:any;run(source.slice(start,end),{creatorReward:{beneficiary:'owner',liability:0n,memeLiability:0n,pendingQuote:0n},wallet:{account:owned?'owner':'other'},rewardActionButton:()=>({}),ownsCreatorRewards:(a:string,b:string)=>a===b,setDisabled:(_:unknown,v:boolean)=>{disabled=v;}});assert.equal(disabled,!owned);}
});
