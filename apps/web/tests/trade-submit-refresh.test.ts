import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {tradeContextKey} from '../src/v1/tradeContext.ts';
import {tradeSubmissionError} from '../src/trade/submission-error.ts';

const native='0x0000000000000000000000000000000000000001';
const pair='0x0000000000000000000000000000000000000002';
function rawControllerFunction(name:string):string{
 const source=readFileSync(new URL('../src/controllers/trade.ts',import.meta.url),'utf8');
 const tree=ts.createSourceFile('trade.ts',source,ts.ScriptTarget.Latest,true);
 let result='';
 const walk=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name){result=node.getText(tree);return;}ts.forEachChild(node,walk);};
 walk(tree);if(!result)throw Error(`Missing controller function: ${name}`);return result;
}

function harness(change?: (state:HarnessState)=>void, failWalletCheck?:boolean){
 const market={market:{marketId:'market-1',quoteAsset:pair,launchPhase:1,canonicalRoute:{router:'0xrouter'}},sync:{revision:'rev-1'}};
 const quote={side:'buy',marketId:'market-1',input:6n,output:100n,minimum:90n,expiresAtMs:Date.now()+60_000,conversion:{sellToken:native,buyToken:pair,sellAmount:'6',minBuyAmount:'5'}};
 const input={value:'6',readOnly:false};
 let contextChecks=0,balanceChecks=0,conversionCalls=0,poolCalls=0;
 const notices:string[]=[];
 const state:HarnessState={ctx:null as never,market,input,quote,notices,get contextChecks(){return contextChecks;},get balanceChecks(){return balanceChecks;},get conversionCalls(){return conversionCalls;},get poolCalls(){return poolCalls;}};
 const ctx:any={foundation:{},wallet:{account:'0xaccount'},tradeMarket:market,tradeQuote:quote,tradeSide:'buy',tradeMetadata:{quoteDecimals:18,quoteSymbol:'PAIR',symbol:'MEME'},tradeMemeLogoUrl:'',tradeMarketVerified:true,tradeSubmitting:false,publicClient:{getBalance:async()=>{balanceChecks++;return 10n**18n;},estimateFeesPerGas:async()=>({maxFeePerGas:1n})},query:(selector:string)=>selector==='[data-trade-amount]'?input:null,required:()=>input,text:()=>{},notify:(message:string)=>notices.push(message),verifyLiveWalletContext:async()=>{contextChecks++;if(failWalletCheck&&contextChecks===2)throw Error('temporary wallet context check failure');},tradeQuoteGeneration:1,tradeSubmittingLabel:'',ensureCanonicalMarket:async()=>{}};
 state.ctx=ctx;
 const globals={
  ctx,recovery:null,recoveryStorageUnavailable:false,tradeWalletRequested:false,tradeSubmitting:false,tradeSubmittingMarketId:undefined,tradeSubmittingLabel:'',
  renderPayments:()=>{},updateTradeAvailability:()=>{},payment:()=>({address:native,symbol:'ETH',decimals:18}),
  quotedMinimum:(value:bigint)=>value,parseTokenAmount:(value:string)=>BigInt(value),
  tradingRoute:()=>true,tradeContextKey,
  tradeConfirmationContent:()=>({}),formatUnits:(value:bigint)=>String(value),quoteIconUrl:()=>'',
  conversionFeeLabel:()=>'',TRADE_NATIVE:native,gasReserve:()=>1n,tradeNetworkReserve:async()=>1n,
  convertPayment:async()=>{conversionCalls++;return {...quote,conversion:undefined};},
  submitPoolTrade:async()=>{poolCalls++;},reportClientError:()=>{},tradeSubmissionError,
 };
 const body=ts.transpileModule(rawControllerFunction('submitTrade'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const submit=new Function(...Object.keys(globals),`${body}; return submitTrade;`)(...Object.values(globals)) as ()=>Promise<void>;
 ctx.confirmFlowAction=async()=>{change?.(state);return true;};
 return {submit,state};
}

type HarnessState={ctx:any;market:any;input:{value:string;readOnly:boolean};quote:any;notices:string[];contextChecks:number;balanceChecks:number;conversionCalls:number;poolCalls:number};

test('a background refresh replacing the market object with the same route still reaches conversion',async()=>{
 const {submit,state}=harness(s=>{s.ctx.tradeMarket={...s.market,market:{...s.market.market}};});
 await submit();
 assert.equal(state.conversionCalls,1);
 assert.equal(state.poolCalls,1);
 assert.equal(state.balanceChecks,1);
 assert.deepEqual(state.notices,[]);
});

for(const change of [
 ['paired asset', (s:HarnessState)=>{s.ctx.tradeMarket={...s.market,market:{...s.market.market,quoteAsset:'0xdifferent'}};}],
 ['route', (s:HarnessState)=>{s.ctx.tradeMarket={...s.market,market:{...s.market.market,canonicalRoute:{router:'0xother'}}};}],
] as const){
 test(`a changed ${change[0]} is rejected before conversion`,async()=>{
  const {submit,state}=harness(change[1]);
  await submit();
  assert.equal(state.conversionCalls,0);
  assert.equal(state.balanceChecks,0);
  assert.match(state.notices[0]??'',/details changed/);
 });
}

test('an amount changed in the confirmation dialog is rejected before conversion',async()=>{
 const {submit,state}=harness(s=>{s.input.value='7';});
 await submit();
 assert.equal(state.conversionCalls,0);
 assert.equal(state.balanceChecks,0);
 assert.match(state.notices[0]??'',/details changed/);
});

test('a pre-wallet context failure tells the user the trade was not submitted',async()=>{
 const {submit,state}=harness(undefined,true);
 await submit();
 assert.equal(state.conversionCalls,0);
 assert.equal(state.poolCalls,0);
 assert.match(state.notices[0]??'',/trade was not submitted/i);
 assert.doesNotMatch(state.notices[0]??'',/wallet transaction history/i);
});
