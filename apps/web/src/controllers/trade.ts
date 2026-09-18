import {stockPurchasePool} from '../trade/stock-pool.ts';
import {paymentAssets,fetchConversion,conversionRequest,TRADE_NATIVE,readRecovery,recoveryKey,type PaymentAsset,type ConversionRecovery,type ConversionQuote} from '../trade/conversion.ts';
import {ALLOWANCE_HOLDER,SETTLER_REGISTRY,registryAbi,conversionSettler,providerToken,preserveConversionMinimum} from '../../../../services/backend-ts/packages/chain/src/quote-purchase/zeroex.ts';
import {renderMarketSettings} from '../ui/market-settings.ts';
import { quotedMinimum, approvedQuoteMinimum, gasReserve, spendableNative } from '../v1/tradeProtection.ts';
import { publicError } from "../ui/public-error.ts";
import { renderTradeEmptyState } from "../ui/trade-empty-state.ts";
import v1Abis_TickerGardenCurve from '../v1/generated/contracts/legacy/TickerGardenCurve.ts';
import v1Abis_ProtocolFeeVault from '../v1/generated/contracts/legacy/ProtocolFeeVault.ts';
import v1Abis_TickerMemeTokenV1 from '../v1/generated/contracts/legacy/TickerMemeTokenV1.ts';
import v1Abis_TickerGardenMemeHook from '../v1/generated/contracts/legacy/TickerGardenMemeHook.ts';
import {
erc20Abi,
formatUnits,
decodeEventLog,
type Hex,
type TransactionReceipt
} from "viem";
import { quoteIconUrl } from "../create/quote-icons.ts";
import { stakingAssetForConfig } from "../create/staking-assets.ts";
import {
assertFinalizedSync,
canonicalAddress,
canonicalBytes32,
configBigInt,
formatTokenAmount,
parseTokenAmount,
phaseLabel,
shortHex,
ZERO_ADDRESS
} from "../runtime/model.ts";
import { robinhoodChain } from "../v1/chain.ts";
import {
buildCurveBuyRequest,
buildCurveSellRequest,
toCurveProgressViewModel
} from "../v1/features/launch.ts";
import { tradingRoute } from "../v1/flowUx.ts";

import { MARKET_PUBLICATION_PENDING,marketIdentityPending,readPublishedMarket } from "../v1/pendingMarket.ts";
import { assertPoolRouterProfile,buildPoolTrade,formatPoolFeeSummary,PERMIT2,permit2Abi,poolAmount,poolPermit2AllowanceFresh,poolPermit2Expiration,poolProtocolFee,poolQuoterAbi,poolRouterAbi,poolSlot0,poolStateAbi,poolSwapAbi,poolTradeRoute,poolTransactionDeadline } from "../v1/poolTrade.ts";
import {
type MarketDetailResponse,
type MarketReadModel
} from "../v1/readApi.ts";
import { ipfsGatewayURL } from "../create/ipfs.ts";
import { tradeContextKey } from "../v1/tradeContext.ts";
import { antiSnipeBps,curveBuyFee,curveTradeMetrics,estimatedPoolTradingFee,formatTradePrice,poolTradeImpactBps } from "../v1/tradePricing.ts";
import type { ControllerContext,CurvePricing,TradeQuote,WalletState } from '../app.ts';
export function createTradeController(ctx:ControllerContext){
let selectedPayment:string|null=null;
let paymentBalance:{account:string;token:string;value:bigint}|null=null;
let recovery:ConversionRecovery|null=null;
let recoveryIdentity='';
let conversionUnavailableFor:string|null=null;
function pairAsset():PaymentAsset|null{return ctx.tradeMarket&&ctx.tradeMetadata?{address:canonicalAddress(ctx.tradeMarket.market.quoteAsset,'Paired asset'),symbol:ctx.tradeMetadata.quoteSymbol,decimals:ctx.tradeMetadata.quoteDecimals}:null;}
function payment():PaymentAsset|null{const pair=pairAsset();return pair?(ctx.tradeSide==='buy'?paymentAssets(robinhoodChain.id,pair).find(a=>a.address===selectedPayment)??pair:pair):null;}
function usesConversion(){return ctx.tradeSide==='buy'&&payment()?.address!==pairAsset()?.address;}
function renderStockPurchaseHint(){
 const node=ctx.query<HTMLElement>('[data-trade-acquire]');if(!node)return;
 node.hidden=true;node.replaceChildren();
 const pair=pairAsset();
 if(!pair||!ctx.wallet||ctx.tradeSide!=='buy'||ctx.tradeSubmitting||recovery)return;
 const pool=stockPurchasePool(robinhoodChain.id,pair.address);if(!pool)return;
 const balance=ctx.detailBalanceAccount===ctx.wallet.account?ctx.detailBalances?.quote:undefined;
 let short=balance===0n;
 if(balance!==undefined&&!usesConversion()){
  const raw=ctx.query<HTMLInputElement>('[data-trade-amount]')?.value.trim();
  if(raw)try{short=parseTokenAmount(raw,pair.decimals,'Amount')>balance;}catch{/* Invalid input does not imply insufficient funds. */}
 }
 const unavailable=usesConversion()&&conversionUnavailableFor===pair.address;
 if(usesConversion()&&!unavailable)return;
 if(!short&&!unavailable)return;
 const link=document.createElement('a');link.href=pool.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Buy Now';link.setAttribute('aria-label',`Buy ${pair.symbol} in the ${pool.version} pool`);
 node.append(link);node.hidden=false;
}
function saveRecovery(value:ConversionRecovery|null,old=value??recovery){
 if(old){const key=recoveryKey(old.account,old.marketId);if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);}if(!old||(old.account===ctx.wallet?.account&&old.marketId===ctx.tradeMarket?.market.marketId))recovery=value;
}
function conversionFeeLabel(q:ConversionQuote){
 const fee=q.providerFee;if(!fee||BigInt(fee.amount)===0n)return '0';
 const sell=payment()!,pair=pairAsset()!;
 const asset=providerToken(fee.token)===providerToken(q.sellToken)?sell:pair;
 return `${formatUnits(BigInt(fee.amount),asset.decimals)} ${asset.symbol} (included)`;
}
function renderPayments(){
 const pair=pairAsset(),node=ctx.query<HTMLSelectElement>('[data-trade-payment-options]');if(!node)return;
 node.hidden=!pair||ctx.tradeSide!=='buy'||robinhoodChain.id!==4663;
 node.disabled=ctx.tradeSubmitting||!!recovery;
 const caret=ctx.query<HTMLElement>('[data-trade-payment-caret]');if(caret)caret.hidden=node.hidden;
 node.parentElement?.classList.toggle('is-selectable',!node.hidden);
 if(pair){const current=payment();const key=`${pair.address}:${current?.address}:${ctx.tradeSubmitting}:${recovery?.state}`;
 if(node.dataset.key!==key){node.dataset.key=key;node.replaceChildren();for(const a of paymentAssets(robinhoodChain.id,pair)){
 const option=document.createElement('option');option.value=a.address;option.textContent=a.symbol;option.selected=a.address===current?.address;node.append(option);}}
 const field=ctx.query<HTMLInputElement>('[data-trade-amount]');if(field)field.dataset.paymentDecimals=String(ctx.tradeSide==='buy'?current?.decimals:18);}
 const check=ctx.query<HTMLButtonElement>('[data-trade-conversion-check]');if(check){check.hidden=!recovery||recovery.state==='funded';check.disabled=ctx.tradeSubmitting;}
 const note=ctx.query<HTMLElement>('[data-trade-conversion-note]');if(note){note.hidden=!usesConversion()&&!recovery;note.textContent=recovery?(recovery.state==='funded'?'Conversion complete. Continue buying with the paired asset already in your wallet.':'Check the existing purchase transaction before starting another purchase.'): `Your ${payment()?.symbol} is exchanged for ${pair?.symbol}, then used to buy ${ctx.tradeMetadata?.symbol}. Any unused paired asset stays in your wallet.`;}
}
async function loadPaymentBalance(){
 const a=payment(),w=ctx.wallet;if(!a||!w||!usesConversion())return;
 try{const value=a.address===TRADE_NATIVE?await ctx.publicClient.getBalance({address:w.account}):await ctx.publicClient.readContract({abi:erc20Abi,address:a.address,functionName:'balanceOf',args:[w.account]});
 if(ctx.wallet!==w||payment()?.address!==a.address)return;paymentBalance={account:w.account,token:a.address,value};renderDetailBalances();updateTradeAvailability();}catch{paymentBalance=null;}
}
async function restoreConversion(){
 const w=ctx.wallet,m=ctx.tradeMarket;if(!w||!m){recovery=null;recoveryIdentity='';return;}
 if(ctx.tradeSubmitting)return;
 const key=recoveryKey(w.account,m.market.marketId),identity=key+':'+localStorage.getItem(key);if(recoveryIdentity===identity)return;recoveryIdentity=identity;recovery=readRecovery(localStorage,w.account,m.market.marketId);
 if(!recovery||recovery.pair!==m.market.quoteAsset){recovery=null;return;}
 let saved=recovery;
 if(saved.state.startsWith('buy_')){
  if(!saved.buyHash){const pending=w.executor.pending(w.account).find(p=>p.businessType==='trade'&&p.marketId===m.market.marketId&&!p.operationKey.startsWith('trade:conversion:')&&!p.approval);if(pending){saved={...saved,state:'buy_pending',buyHash:pending.hash};saveRecovery(saved);}}
  if(saved.buyHash){try{const receipt=await ctx.publicClient.getTransactionReceipt({hash:saved.buyHash});if(ctx.wallet!==w||ctx.tradeMarket?.market.marketId!==m.market.marketId)return;
    const pending=w.executor.pending(w.account).find(p=>p.hash===saved.buyHash);if(pending)await w.executor.reconcilePending(w.account,pending.operationKey);
    if(receipt.status==='success'&&receipt.to?.toLowerCase()===saved.buyTo?.toLowerCase()&&receipt.from.toLowerCase()===w.account.toLowerCase()&&!pending?.cancelled)saveRecovery(null);
    else saveRecovery({...saved,state:'funded',buyTo:undefined,buyHash:undefined});
  }catch{/* Keep the existing purchase paused while its receipt is unknown. */}}
  if(recovery?.state==='funded'){selectedPayment=m.market.quoteAsset;const field=ctx.query<HTMLInputElement>('[data-trade-amount]');if(field)field.value=formatUnits(BigInt(recovery.amount),ctx.tradeMetadata!.quoteDecimals);scheduleTradeQuote();}
  renderPayments();updateTradeAvailability();return;
 }
 if(saved.state!=='funded'&&!saved.hash){
  const pending=w.executor.pending(w.account).find(p=>p.operationKey.startsWith(`trade:conversion:${m.market.marketId}:`)&&!p.approval);
  if(pending){saved={...saved,state:'pending',hash:pending.hash};saveRecovery(saved);}
 }
 if(saved.state!=='funded'&&saved.hash){try{const receipt=await ctx.publicClient.getTransactionReceipt({hash:saved.hash});if(ctx.wallet!==w||ctx.tradeMarket?.market.marketId!==m.market.marketId)return;if(receipt.from.toLowerCase()===w.account.toLowerCase()){
 const pending=w.executor.pending(w.account).find(p=>p.hash===saved.hash);
 if(pending)await w.executor.reconcilePending(w.account,pending.operationKey);
 if(ctx.wallet!==w||ctx.tradeMarket?.market.marketId!==m.market.marketId)return;
 if(receipt.status==='success'&&receipt.to?.toLowerCase()===ALLOWANCE_HOLDER&&!pending?.cancelled)saveRecovery({...saved,state:'funded'});else saveRecovery(null);
 }}catch{/* Pending hashes remain blocked. */}}
 if(recovery?.state==='funded'){selectedPayment=m.market.quoteAsset;const f=ctx.query<HTMLInputElement>('[data-trade-amount]');if(f)f.value=formatUnits(BigInt(recovery.amount),ctx.tradeMetadata!.quoteDecimals);scheduleTradeQuote();}renderPayments();updateTradeAvailability();
}

async function loadCurvePricing(market:MarketReadModel):Promise<CurvePricing>{
 if(ctx.curvePricing?.marketId===market.marketId&&Date.now()-ctx.curvePricing.at<15000)return ctx.curvePricing;
 if(ctx.curvePricingPending?.marketId===market.marketId)return ctx.curvePricingPending.promise;
 const promise=(async()=>{
  const baseline=ctx.foundation?.baseline.find(c=>c.id===market.tickerGardenBaselineId);if(!baseline)throw Error('Fee configuration missing');
  const baseBps=configBigInt(baseline,'curveFeeBps');
  const block=await ctx.publicClient.getBlock({blockTag:'latest'});
  const args={address:canonicalAddress(market.curve,'Curve'),abi:v1Abis_TickerGardenCurve,blockNumber:block.number};
  const [reserves,tax]=await Promise.all([ctx.publicClient.readContract({...args,functionName:'getReserves'}),ctx.publicClient.readContract({...args,functionName:'creatorTaxBps'})]);
  const result={marketId:market.marketId,blockNumber:block.number,timestamp:block.timestamp,quoteReserve:reserves[0],tokenReserve:reserves[1],baseBps,taxBps:BigInt(tax),at:Date.now()};
  if(ctx.tradeMarket?.market===market)ctx.curvePricing=result;
  return result;
 })();
 ctx.curvePricingPending={marketId:market.marketId,promise};
 try{return await promise;}finally{if(ctx.curvePricingPending?.promise===promise)ctx.curvePricingPending=null;}
}

async function loadPoolQuoteBindings(market:MarketReadModel,blockNumber:bigint){
 const route=poolTradeRoute(market,'buy');
 const cacheKey=`${route.router}:${route.quoter}:${market.curve}`;
 const previous=ctx.poolQuoteBindings.get(cacheKey);if(previous)return previous;
 const pending=(async()=>{
  const [manager,quoterManager,taxBps,vaultManager]=await Promise.all([
   ctx.publicClient.readContract({abi:poolRouterAbi,address:route.router,functionName:'poolManager',blockNumber}),
   ctx.publicClient.readContract({abi:poolQuoterAbi,address:route.quoter,functionName:'poolManager',blockNumber}),
   ctx.publicClient.readContract({abi:v1Abis_TickerGardenCurve,address:canonicalAddress(market.curve,'Curve'),functionName:'creatorTaxBps',blockNumber}),
   ctx.publicClient.readContract({abi:v1Abis_ProtocolFeeVault,address:ctx.marketRelease(market.marketId).feeVault,functionName:'poolManager',blockNumber})]);
  if(manager.toLowerCase()!==quoterManager.toLowerCase()||manager.toLowerCase()!==vaultManager.toLowerCase()||manager===ZERO_ADDRESS||taxBps>500)throw Error('Invalid pool quote binding');
  return {manager,taxBps};
 })();
 if(ctx.poolQuoteBindings.size>=32)ctx.poolQuoteBindings.delete(ctx.poolQuoteBindings.keys().next().value!);
 ctx.poolQuoteBindings.set(cacheKey,pending);
 try{return await pending;}catch(error){if(ctx.poolQuoteBindings.get(cacheKey)===pending)ctx.poolQuoteBindings.delete(cacheKey);throw error;}
}

async function tradeNetworkReserve(market:MarketDetailResponse,quote:TradeQuote|null,account:WalletState['account']):Promise<bigint>{
 const fees=await ctx.publicClient.estimateFeesPerGas(),price=fees.maxFeePerGas??fees.gasPrice;
 if(!price)throw Error('Network fee could not be estimated.');
 let gas=8_000_000n; // Conservative fallback covers the existing staking settlement gas limit.
 if(quote&&quote.marketId===market.market.marketId){
   const request=market.market.launchPhase===1&&quote.transactionDeadline!==undefined
    ?buildPoolTrade(market.market,quote.side,quote.input,quote.minimum,quote.transactionDeadline)
    :market.market.launchPhase===0?(quote.side==='buy'?buildCurveBuyRequest({marketResponse:market,quoteIn:quote.input,minTokensOut:quote.minimum,recipient:account}):buildCurveSellRequest({marketResponse:market,tokensIn:quote.input,minQuoteOut:quote.minimum,recipient:account})).request:null;
   if(request){try{const estimate=await ctx.publicClient.estimateContractGas({...request,account} as never);gas=request.gas&&request.gas>estimate?request.gas:estimate;}catch{/* Approval or insufficient native value can prevent estimation; retain the conservative budget. */}}
 }
 return gasReserve(gas,price);
}
function setupTrade(): void {
 ctx.query<HTMLElement>('.trade-live')?.addEventListener('market-regions',event=>{
  const detail=(event as CustomEvent<{marketId:string;regions:string[]}>).detail;
  if(ctx.currentPage()!=='trade'||ctx.tradeMarket?.market.marketId!==detail.marketId)return;
  if(detail.regions.includes('market'))void refreshTradeFields(undefined,true,detail.regions.includes('staking'));
  else if(detail.regions.includes('staking'))void refreshTradeStake();
 });
 ctx.query<HTMLButtonElement>('[data-trade-conversion-check]')?.addEventListener('click',async()=>{
 recoveryIdentity='';await restoreConversion();const saved=recovery;
 if(saved&&saved.state!=='funded'&&!(saved.state.startsWith('buy_')?saved.buyHash:saved.hash)&&!ctx.tradeSubmitting){
 const wallet=ctx.wallet;
 const reset=await ctx.confirmFlowAction('Check your wallet transaction history first. Reset only if you cancelled the request and no transaction was submitted. Keep this purchase paused if a transaction is pending or successful.',{title:'Check your wallet',confirmLabel:'Reset cancelled request'});
 if(reset&&ctx.wallet===wallet&&recovery===saved&&!wallet?.executor.pending(wallet.account).some(p=>p.conflictKey===`trade:${saved.marketId}`)){saveRecovery(saved.state.startsWith('buy_')?{...saved,state:'funded',buyHash:undefined,buyTo:undefined}:null);renderTradeQuote();scheduleTradeQuote();}
 }
 });
 ctx.query<HTMLSelectElement>('[data-trade-payment-options]')?.addEventListener('change',event=>{
 const select=event.target instanceof HTMLSelectElement?event.target:null;const pair=pairAsset();if(!select||!pair||ctx.tradeSide!=='buy'||ctx.tradeSubmitting||recovery||!paymentAssets(robinhoodChain.id,pair).some(a=>a.address===select.value))return;
 selectedPayment=select.value;paymentBalance=null;ctx.tradeQuote=null;const f=ctx.query<HTMLInputElement>('[data-trade-amount]');if(f)f.value='';renderTradeQuote();void loadPaymentBalance();scheduleTradeQuote();
 });
  ctx.query<HTMLButtonElement>('[data-trade-retry]')?.addEventListener('click',()=>{ctx.snapshotPoller?.reconnect();void loadTradeMarket();});
  const requested = new URL(window.location.href).searchParams.get("marketId")?.trim() ?? "";
  renderTradeEmptyState(!requested ? "missing" : /^0x[0-9a-fA-F]{64}$/.test(requested) ? null : "invalid");
  if (/^0x[0-9a-fA-F]{64}$/.test(requested)) setTradePageLoading(true);
  ctx.query<HTMLElement>('.ref-links')?.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button[data-external-url]'):null;
    if(!button||button.hidden||button.disabled||!button.dataset.externalUrl)return;
    try{const url=new URL(button.dataset.externalUrl);if(!['https:','http:'].includes(url.protocol))return;window.open(url.href,'_blank','noopener,noreferrer');}catch{/* Invalid metadata links stay inert. */}
  },{capture:true});
  ctx.tradePhaseTimer = window.setInterval(() => {
    if(document.hidden||ctx.currentPage()!=='trade'||ctx.tradeMarket)return;
    // Retry only the missing core record; statistics and global health never gate it.
    void loadTradeMarket();
  }, 60000);

  ctx.queryAll<HTMLButtonElement>('[data-fill-trade-balance]').forEach(button=>button.addEventListener('click',async()=>{
    if(usesConversion())return;
    if(!ctx.wallet||!ctx.tradeMetadata||ctx.detailBalanceAccount!==ctx.wallet.account)return;
    const side=button.dataset.fillTradeBalance==='receive'?(ctx.tradeSide==='buy'?'sell':'buy'):ctx.tradeSide;
    const balance=side==='buy'?ctx.detailBalances?.quote:ctx.detailBalances?.meme;
    if(balance===undefined||balance<=0n)return;
    const amount=ctx.query<HTMLInputElement>('[data-trade-amount]');if(!amount)return;
    const wallet=ctx.wallet,market=ctx.tradeMarket,original=amount.value,oldSide=ctx.tradeSide;
    let available=balance;
    if(side==='buy'&&market?.market.quoteAsset===ZERO_ADDRESS){
      button.disabled=true;
      try{const reserve=await tradeNetworkReserve(market,ctx.tradeQuote?.side===side?ctx.tradeQuote:null,wallet.account);
        const live=await ctx.publicClient.getBalance({address:wallet.account});
        available=spendableNative(live,reserve);
        if(ctx.wallet!==wallet||ctx.tradeMarket!==market||!amount.isConnected||amount.value!==original||ctx.tradeSide!==oldSide)return;
        if(available===0n){ctx.text('[data-trade-status]','Keep enough ETH for the network fee.');return;}
      }catch{ctx.text('[data-trade-status]','Could not estimate the network fee. Try again.');return;}
      finally{if(button.isConnected)button.disabled=false;}
    }
    amount.value=formatUnits(available,side==='buy'?ctx.tradeMetadata.quoteDecimals:18);
    if(side!==ctx.tradeSide)ctx.query<HTMLButtonElement>(`[data-trade-side="${side}"]`)?.click();
    else amount.dispatchEvent(new Event('input',{bubbles:true}));
    amount.focus();
  }));
  ctx.query<HTMLButtonElement>('[data-detail-connect]')?.addEventListener('click',()=>ctx.query<HTMLButtonElement>('[data-wallet]')?.click());
  ctx.query<HTMLButtonElement>('[data-detail-fee-details]')?.addEventListener('click',()=>{const node=ctx.query<HTMLElement>('[data-detail-fee-rows]')?.closest<HTMLElement>('section');node?.scrollIntoView({behavior:'smooth',block:'center'});node?.focus({preventScroll:true});});
  let tradeReverseRotation=0;
  ctx.query<HTMLButtonElement>('[data-trade-reverse]')?.addEventListener('click',event=>{
    const button=event.currentTarget as HTMLButtonElement;
    tradeReverseRotation+=180;
    const icon=button.querySelector<HTMLElement>('.ph');if(icon)icon.style.transform=`rotate(${tradeReverseRotation}deg)`;
    ctx.query<HTMLButtonElement>(`[data-trade-side="${ctx.tradeSide==='buy'?'sell':'buy'}"]`)?.click();
  });
  ctx.queryAll<HTMLButtonElement>('[data-detail-tab]').forEach(button => button.addEventListener('click', () => {
    ctx.queryAll<HTMLButtonElement>('[data-detail-tab]').forEach(tab => {
      tab.classList.toggle('active', tab === button);
      tab.setAttribute('aria-selected', String(tab === button));
      tab.tabIndex = tab === button ? 0 : -1;
    });
    ctx.queryAll<HTMLElement>('[data-detail-panel]').forEach(panel => { panel.hidden = panel.dataset.detailPanel !== button.dataset.detailTab; });
  }));
  ctx.queryAll<HTMLButtonElement>('[data-detail-tab]').forEach((button, _index, tabs) => button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.click();
  }));
  ctx.query<HTMLButtonElement>('[data-detail-copy]')?.addEventListener('click', () => {
    if (!ctx.tradeMarket) return;
    window.open(`${robinhoodChain.blockExplorers.default.url}/token/${ctx.tradeMarket.market.memeToken}`, '_blank', 'noopener,noreferrer');
  });
  ctx.queryAll<HTMLButtonElement>("[data-trade-side]").forEach((button) => button.addEventListener("click", () => {
    if(ctx.tradeSubmitting)return;
    ctx.tradeSide = button.dataset.tradeSide === "sell" ? "sell" : "buy";
    ctx.queryAll<HTMLButtonElement>("[data-trade-side]").forEach((item) => {item.classList.toggle("active", item === button);item.setAttribute("aria-pressed",String(item===button));});
    ctx.tradeQuote = null;
    renderTradeQuote();
    scheduleTradeQuote();
  }));
  const tradeAmountInput=ctx.query<HTMLInputElement>('[data-trade-amount]');
  if(tradeAmountInput){
    let lastAmount=tradeAmountInput.value;
    const decimal=/^[0-9]*(?:\.[0-9]*)?$/;
    const accepts=(insert:string)=>{
      const start=tradeAmountInput.selectionStart??tradeAmountInput.value.length,end=tradeAmountInput.selectionEnd??start;
      return decimal.test(tradeAmountInput.value.slice(0,start)+insert+tradeAmountInput.value.slice(end));
    };
    tradeAmountInput.addEventListener('beforeinput',event=>{if(event.data!==null&&!accepts(event.data))event.preventDefault();});
    tradeAmountInput.addEventListener('paste',event=>{const value=event.clipboardData?.getData('text');if(value!==undefined&&!accepts(value))event.preventDefault();});
    tradeAmountInput.addEventListener('input',()=>{
      if(!decimal.test(tradeAmountInput.value)){
        tradeAmountInput.value=lastAmount;
        tradeAmountInput.dispatchEvent(new Event('input',{bubbles:true}));return;
      }
      lastAmount=tradeAmountInput.value;
      scheduleTradeQuote();
    });
  }
  ctx.query<HTMLFormElement>("[data-trade-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void ctx.runPageAction(submitTrade);
  });
  ctx.queryAll<HTMLButtonElement>('[data-trade-stake-action]').forEach(button=>button.addEventListener('click',()=>{
    if(!ctx.tradeMarket)return;
    ctx.router.navigate(`/stake?marketId=${encodeURIComponent(ctx.tradeMarket.market.marketId)}&action=${button.dataset.tradeStakeAction}#positions`);
  }));
  // refreshCurrentPage owns the initial market load. Starting a second load
  // here races the route refresh, which can clear and cancel the detail/chart
  // request after it has already accepted the same market identity.
  updateTradeAvailability();
}

async function refreshMarketOverview(_preserve=false):Promise<void>{
 const market=ctx.tradeMarket?.market;if(!market)return;
 // Display values come exclusively from the database response. An old event
 // timestamp is not evidence that an unchanged supply or price is invalid.
 const display=market.display;
 ctx.tokenDetailWidget?.setOverview({asOf:display?Number(display.asOfTimestamp):undefined,supply:display?.totalSupplyRaw,price:display?.priceQuote??undefined,usd:ctx.assetPrices.midpointUsd(market.quoteAsset)??undefined});
 void renderTradeFeeDetails(market,ctx.tradeLoadGeneration);
}

async function refreshTradeStake():Promise<void>{
  const generation=++ctx.tradeStakeGeneration;
  const detail=ctx.tradeMarket,account=ctx.wallet?.account;
  ctx.tradeStakeAccount=account;
  const panel=ctx.query<HTMLElement>('[data-trade-stake-summary]');
  if(!panel)return;
  panel.hidden=!detail||detail.market.gauge===ZERO_ADDRESS;
  ctx.queryAll<HTMLElement>('[data-trade-stake-base]').forEach(element=>{element.hidden=panel.hidden;});
  if(panel.hidden||!detail)return;
  ctx.text('[data-trade-stake-total]','-');ctx.text('[data-trade-stake-user]','-');
  const market=detail.market;
  const add=ctx.query<HTMLButtonElement>('[data-trade-stake-action="add"]');
  const withdraw=ctx.query<HTMLButtonElement>('[data-trade-stake-action="withdraw"]');
  if(add)add.disabled=market.launchPhase!==1;
  if(withdraw)withdraw.disabled=true;
  ctx.text('[data-trade-stake-note]',market.launchPhase!==1?'Staking opens after Blooming':!account?'Connect your wallet to view your stake':'');
  try{
    const config=ctx.findAsset(market.assetUid);
    const decimals=Number(config.values.tokenDecimals);
    if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Invalid Stock Decimals');
    const current=()=>generation===ctx.tradeStakeGeneration&&ctx.tradeMarket===detail&&ctx.wallet?.account===account;
    const display=(value:bigint)=>`${formatTokenAmount(value,decimals)} ${ctx.stockSymbol(config)}`;
    if(market.display)ctx.text('[data-trade-stake-total]',display(BigInt(market.display.totalStakedRaw)));
    if(account&&ctx.readApi){
      let cursor:string|undefined,positionRevision:string|undefined;let found=false;
      do{
        const page=await ctx.readApi.listUserPositions({address:account,...(positionRevision?{revision:positionRevision}:{}),...(cursor?{cursor}:{})});
        assertFinalizedSync(page.sync,positionRevision,'Stake position');positionRevision=page.sync.revision;
        if(!current())return;
        const position=page.items.find(p=>p.marketId===market.marketId);
        if(position){ctx.text('[data-trade-stake-user]',display(BigInt(position.allocated)));if(withdraw)withdraw.disabled=BigInt(position.allocated)===0n;found=true;break;}
        cursor=page.nextCursor??undefined;
      }while(cursor);
      if(!found&&current())ctx.text('[data-trade-stake-user]',display(0n));
    }
  }catch{/* Display-only reads never block trading. */}
}

function renderDetailStakingSymbol(symbol: string, logoUrl?: string): void {
  ctx.text('[data-detail-staking-symbol]',symbol);
  for(const image of ctx.queryAll<HTMLImageElement>('[data-detail-staking-logo], [data-detail-stock-logo]')){
    const url=logoUrl??quoteIconUrl(symbol);image.hidden=!url;image.alt=url?`${symbol} Logo`:'';image.onerror=()=>{image.hidden=true;};if(url)image.src=url;else image.removeAttribute('src');
  }
}

function renderTradeAssetLogo(selector:string,url:string|undefined,symbol:string):void{
  const image=ctx.query<HTMLImageElement>(selector);if(!image)return;
  image.hidden=!ctx.tradeMetadata;
  image.alt=ctx.tradeMetadata?`${symbol} Logo`:'';
  if(!ctx.tradeMetadata){image.removeAttribute('src');delete image.dataset.logoSource;return;}
  const source=url??ctx.tradeTokenLogoFallback;
  if(image.dataset.logoSource===source&&image.hasAttribute('src'))return;
  image.dataset.logoSource=source;
  image.onerror=()=>{image.onerror=null;image.src=ctx.tradeTokenLogoFallback;};
  image.src=source;
}

function clearTradeMarketState(): void {
 selectedPayment=null;paymentBalance=null;recovery=null;recoveryIdentity="";conversionUnavailableFor=null;
 const acquire=ctx.query<HTMLElement>('[data-trade-acquire]');if(acquire){acquire.hidden=true;acquire.replaceChildren();}
  ++ctx.tradeStakeGeneration;
  if(ctx.tradeMarket)ctx.overviewLoads.delete(ctx.tradeMarket.market.marketId);
  ctx.queryAll<HTMLElement>('[data-trade-stake-base]').forEach(element=>{element.hidden=true;});
  const stakeSummary=ctx.query<HTMLElement>('[data-trade-stake-summary]');if(stakeSummary)stakeSummary.hidden=true;
  const stakingBadge=ctx.query<HTMLElement>('[data-detail-staking-badge]');if(stakingBadge)stakingBadge.hidden=true;
  renderDetailStakingSymbol('-');
  const quoteLogo=ctx.query<HTMLImageElement>('[data-detail-quote-logo]');if(quoteLogo){quoteLogo.hidden=true;quoteLogo.removeAttribute('src');quoteLogo.alt='';}
  ctx.tradeMarket = null;
  ctx.tradeMarketVerified = false;
  ctx.curvePricing=null;
  ctx.query<HTMLElement>('.ref-hero')?.setAttribute('aria-busy','true');
  ctx.query<HTMLElement>('[data-detail-phase]')?.classList.remove('is-bloomed');
  ctx.text('[data-detail-phase]','Loading market');ctx.text('[data-detail-phase-note]','');ctx.text('[data-detail-trading-pool]','Loading trading route…');
  const graduation=ctx.query<HTMLElement>('[data-detail-graduation]');if(graduation)graduation.hidden=true;
  ctx.tokenDetailWidget?.setMarket(null);
  ctx.detailContentAbort?.abort();ctx.detailContentAbort=null;
  ctx.detailBalanceLoader.clear();ctx.detailBalanceAccount=undefined;ctx.detailBalances=null;
  ctx.queryAll<HTMLElement>('[data-detail-symbol]').forEach(el=>el.textContent='-');
  ctx.text('[data-detail-description]','Loading description…');
  const avatar=ctx.query<HTMLImageElement>('[data-detail-image]');if(avatar){const fallback=new URL("../../assets/token-placeholder.svg",import.meta.url).href;avatar.onerror=()=>{avatar.onerror=null;avatar.src=fallback;};avatar.src=fallback;}
  for(const key of ['website','x']){const link=ctx.query<HTMLButtonElement>(`[data-detail-${key}]`);if(link){link.hidden=false;link.disabled=true;delete link.dataset.externalUrl;link.removeAttribute('title');}}
  ctx.text('[data-detail-stock-label]','-');ctx.text('[data-detail-venue]','-');
  for (const key of ['symbol', 'token', 'created', 'creator', 'supply', 'volume', 'cap', 'holders', 'fees', 'fee-rules']) ctx.text(`[data-detail-${key}]`, '-');
  renderMarketSettings(document,null);
  ctx.text('[data-detail-fee-note]', 'Load a verified market to view fee allocation rules.');
  const explorer = ctx.query<HTMLAnchorElement>('[data-detail-explorer]');
  if (explorer) { explorer.hidden = true; explorer.removeAttribute('href'); }
  const copy = ctx.query<HTMLButtonElement>('[data-detail-copy]'); if (copy) copy.disabled = true;
  ctx.tradeMetadata = null;
  ctx.tradeMemeLogoUrl = ctx.tradeTokenLogoFallback;
  ctx.tradeQuote = null;
  ctx.displayPriceWidget?.setToken(null);
  ctx.candleWidget?.setMarket(null);
  ctx.tradeHistoryWidget?.setMarket(null);
  ctx.holderWidget?.setMarket(null);
  ctx.text("[data-trade-market-name]", "Market details");
  for (const selector of ["[data-trade-stock]", "[data-trade-quote]", "[data-trade-phase]", "[data-trade-summary-id]"]) ctx.text(selector, "-");
  ctx.text("[data-trade-market-note]", "");
  renderTradeQuote();
}

async function verifyTradeMarket(detail: MarketDetailResponse, generation: number): Promise<void> {
  try {
    await ctx.ensureCanonicalMarket(detail.market);
    if (generation !== ctx.tradeLoadGeneration || ctx.tradeMarket?.market.marketId !== detail.market.marketId
      || tradeContextKey(ctx.tradeMarket.market)!==tradeContextKey(detail.market)) return;
    ctx.tradeMarketVerified = true;
    // Public fee allocation is rendered from the database independently of this RPC verification.
    if (detail.market.launchPhase === 0) void loadCurvePricing(detail.market).then(() => {
      if (generation === ctx.tradeLoadGeneration && ctx.tradeMarketVerified && !ctx.tradeQuote) renderTradeQuote();
    }).catch(() => {});
    updateTradeAvailability();

  } catch {
    if (generation !== ctx.tradeLoadGeneration || ctx.tradeMarket?.market.marketId !== detail.market.marketId) return;
    ctx.tradeMarketVerified = false;

    updateTradeAvailability();
  }
}

async function loadDetailContent(market:MarketReadModel,generation:number):Promise<void>{
  if(generation!==ctx.tradeLoadGeneration)return;
  const value=market.content;
  if(!value){ctx.text('[data-detail-description]','');return;}
  ctx.text('[data-detail-description]',value.description||'No description added.');
  const imageUrl=value.imageURI?ipfsGatewayURL(value.imageURI,import.meta.env.VITE_IPFS_GATEWAY):null;
  const image=ctx.query<HTMLImageElement>('[data-detail-image]');if(image&&imageUrl)image.src=imageUrl;
  ctx.tradeMemeLogoUrl=imageUrl||ctx.tradeTokenLogoFallback;renderTradeQuote();
  for(const key of ['website','x'] as const){const link=ctx.query<HTMLButtonElement>(`[data-detail-${key}]`);if(link){const url=value[key];link.hidden=!url;link.disabled=!url;if(url){link.dataset.externalUrl=url;link.title=url;}else delete link.dataset.externalUrl;}}
}

function renderDetailBalances():void{
 renderStockPurchaseHint();
 if(ctx.detailBalanceAccount!==ctx.wallet?.account)ctx.detailBalances=null;
 const pay=usesConversion()?(paymentBalance&&paymentBalance.account===ctx.wallet?.account&&paymentBalance.token===payment()?.address?paymentBalance.value:undefined):ctx.tradeSide==='buy'?ctx.detailBalances?.quote:ctx.detailBalances?.meme,receive=ctx.tradeSide==='buy'?ctx.detailBalances?.meme:ctx.detailBalances?.quote;
 ctx.text('[data-detail-pay-balance]',pay===undefined||!ctx.tradeMetadata?'-':`${formatTokenAmount(pay,ctx.tradeSide==='buy'?payment()!.decimals:18)} ${ctx.tradeSide==='buy'?payment()!.symbol:ctx.tradeMetadata.symbol}`);
 ctx.text('[data-detail-receive-balance]',receive===undefined||!ctx.tradeMetadata?'-':`${formatTokenAmount(receive,ctx.tradeSide==='buy'?18:ctx.tradeMetadata.quoteDecimals)} ${ctx.tradeSide==='buy'?ctx.tradeMetadata.symbol:ctx.tradeMetadata.quoteSymbol}`);
 for(const [side,balance] of [['pay',pay],['receive',receive]] as const){const button=ctx.query<HTMLButtonElement>(`[data-fill-trade-balance="${side}"]`);if(button){button.disabled=usesConversion()||!ctx.wallet||!ctx.tradeMetadata||balance===undefined||balance<=0n;const symbol=side==='pay'?(ctx.tradeSide==='buy'?ctx.tradeMetadata?.quoteSymbol:ctx.tradeMetadata?.symbol):(ctx.tradeSide==='buy'?ctx.tradeMetadata?.symbol:ctx.tradeMetadata?.quoteSymbol);const label=side==='pay'?`Use full ${symbol??'pay asset'} balance`:`Switch direction and use full ${symbol??'receive asset'} balance`;button.setAttribute('aria-label',label);button.title=label;}}

}

async function loadDetailBalances(preserve=true):Promise<void>{
 void loadPaymentBalance();
 const market=ctx.tradeMarket?.market,account=ctx.wallet?.account;
 if(!preserve)ctx.detailBalanceLoader.clear();
 ctx.detailBalanceAccount=account;
 if(!market||!account){ctx.detailBalanceLoader.clear();return;}
 // Database snapshot objects change independently of wallet/asset identity.
 await ctx.detailBalanceLoader.load({key:`${robinhoodChain.id}:${market.marketId}:${account}:${market.quoteAsset}:${market.memeToken}`,account,quote:market.quoteAsset,meme:market.memeToken});
}

function retryMissingDetailBalances():void{
 if(ctx.currentPage()==='trade'&&ctx.wallet&&!document.hidden&&navigator.onLine&&(ctx.detailBalances?.quote===undefined||ctx.detailBalances?.meme===undefined))void loadDetailBalances();
}

function setTradePageLoading(loading:boolean):void{
 clearTimeout(ctx.tradeLoadingTimeout);
 const overlay=ctx.query<HTMLElement>('[data-trade-page-loading]');if(!overlay)return;
 overlay.hidden=!loading;
 overlay.parentElement?.setAttribute('aria-busy',String(loading));
 // Slow optional or failed services must not hold the whole page indefinitely.
 if(loading)ctx.tradeLoadingTimeout=setTimeout(()=>setTradePageLoading(false),10000);
}

async function loadTradeMarket(explicit?: string): Promise<void> {
  const requested = explicit ?? new URL(window.location.href).searchParams.get('marketId') ?? '';
  if (ctx.tradeMarket && ctx.tradeMarket.market.marketId === requested.trim().toLowerCase()) {
    renderTradeEmptyState(null);
    await refreshTradeFields(undefined, true);
    return;
  }
  // Clear the old target before parsing or any prerequisite can fail.
  setTradePageLoading(false);
  clearTradeMarketState();
  const generation = ++ctx.tradeLoadGeneration;
  ctx.tradeQuoteGeneration += 1;
  window.clearTimeout(ctx.tradeQuoteTimer);
  const raw = explicit ?? new URL(window.location.href).searchParams.get("marketId") ?? "";
  let marketId: Hex;
  try { marketId = canonicalBytes32(raw.trim().toLowerCase(), "marketId"); }
  catch { renderTradeEmptyState(raw.trim() ? "invalid" : "missing"); updateTradeAvailability(); return; }
  // Wallet restoration and route mounting can reach this concurrently. Join the
  // market-scoped bootstrap before deciding that a missing foundation is an error.
  renderTradeEmptyState(null);
  setTradePageLoading(true);
  if (!ctx.foundation && ctx.readApi) await ctx.loadFoundation();
  if (generation !== ctx.tradeLoadGeneration || ctx.currentPage() !== 'trade') return;

  if (!ctx.foundation || (!ctx.readApi && !ctx.foundation.direct)) {
    renderTradeEmptyState(ctx.latestListing?.marketId===marketId?"preparing":"unavailable");
    updateTradeAvailability();
    return;
  }
  renderTradeEmptyState(null);
  setTradePageLoading(true);
  ctx.setPageStatus("Loading market details…");
  ctx.tradeQuote = null;
  ctx.displayPriceWidget?.setToken(null);
  try {
    // The finalized directory already contains the complete display record. Use
    // it immediately and refresh route state in the background.
    const known = ctx.foundation.markets.find(m => m.marketId === marketId);
    const earlyMetadata = known&&!marketIdentityPending(known) ? ctx.marketMetadata(known) : null;
    void earlyMetadata?.catch(()=>{});
    const response = known && !marketIdentityPending(known) && !ctx.foundation.direct
      ? { market: known, sync: ctx.foundation.sync }
      : ctx.foundation.direct && ctx.directMarkets
        ? await ctx.directMarkets.market(marketId)
        : await ctx.readApi!.getMarketPageBootstrap({marketId});
    if (generation !== ctx.tradeLoadGeneration) return;
    if(!response){
      renderTradeEmptyState('preparing');
      ctx.text('[data-detail-phase]','Waiting for market data');
      ctx.text('[data-detail-phase-note]',MARKET_PUBLICATION_PENDING);
      ctx.text('[data-detail-description]','');
      ctx.query<HTMLElement>('.ref-hero')?.setAttribute('aria-busy','false');
      ctx.tokenDetailWidget?.setUnavailable(true);
      ctx.setPageStatus(MARKET_PUBLICATION_PENDING,'warning');
      updateTradeAvailability();
      return;
    }
    if (response.market.marketId !== marketId) throw new Error("Read API returned a different market identity");
    if (ctx.foundation.direct) assertFinalizedSync(response.sync, undefined, "market detail");
    if(marketIdentityPending(response.market)){renderTradeEmptyState('preparing');ctx.setPageStatus(MARKET_PUBLICATION_PENDING);updateTradeAvailability();return;}
    const metadata = await (earlyMetadata && known?.memeToken === response.market.memeToken && known.quoteAssetConfigId === response.market.quoteAssetConfigId ? earlyMetadata : ctx.marketMetadata(response.market));
    const view = toCurveProgressViewModel(response);
    if (generation !== ctx.tradeLoadGeneration) return;
    ctx.tradeMarket = response;
    ctx.query<HTMLElement>('.ref-hero')?.setAttribute('aria-busy','false');
    ctx.tradeMetadata = metadata;
    const quoteLogo=ctx.query<HTMLImageElement>('[data-detail-quote-logo]');
    if(quoteLogo){const url=quoteIconUrl(metadata.quoteSymbol);quoteLogo.hidden=!url;quoteLogo.alt=`${metadata.quoteSymbol} Logo`;quoteLogo.onerror=()=>{quoteLogo.hidden=true;};if(url)quoteLogo.src=url;else quoteLogo.removeAttribute('src');}
    ctx.queryAll<HTMLElement>('[data-detail-symbol]').forEach(el=>el.textContent=metadata.symbol);
    const baseline=ctx.foundation.baseline.find(c=>c.kind==='baseline'&&c.id===response.market.tickerGardenBaselineId);
    const supply=baseline?.values.supply;
    const graduated=response.market.launchPhase===1;
    renderTradePhase(graduated);
    const progressLabel=ctx.query<HTMLElement>('[data-detail-progress-label]');if(progressLabel)progressLabel.hidden=graduated;
    ctx.text('[data-detail-phase-note]','');
    const graduation=ctx.query<HTMLElement>('[data-detail-graduation]');if(graduation)graduation.hidden=graduated;
    const progress=ctx.marketBloomProgress(response.market);
    ctx.text('[data-detail-progress-label]',progress===null?'-':`${progress.toFixed(2)}%`);
    const bar=ctx.query<HTMLProgressElement>('[data-detail-progress]');if(bar){if(progress===null)bar.removeAttribute('value');else bar.value=progress;}
    renderTradePoolAddress(response.market);
    ctx.text('[data-detail-supply]',typeof supply==='string'?formatTokenAmount(BigInt(supply),18):'-');
    ctx.tokenDetailWidget?.setMarket({marketId:response.market.marketId,memeToken:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals,symbol:metadata.symbol,quoteSymbol:metadata.quoteSymbol,createdAt:Number(response.market.identity?.deployedAt??metadata.deployedAt)||undefined});
    void refreshMarketOverview();
    void loadDetailContent(response.market,generation);
    void loadDetailBalances();
    ctx.text('[data-detail-token]', shortHex(response.market.memeToken));
    const deployed = response.market.identity?.deployedAt??metadata.deployedAt;
    const date = deployed && /^\d+$/.test(deployed) ? new Date(Number(deployed) * 1000) : null;
    ctx.text('[data-detail-created]', date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', {year:'numeric', month:'short', day:'numeric'}) : '-');
    // Detail analytics owns volume and circulating cap; directory metrics use FDV.
    const explorer = ctx.query<HTMLAnchorElement>('[data-detail-explorer]');
    if (explorer) { explorer.href = `${robinhoodChain.blockExplorers.default.url}/token/${response.market.memeToken}`; explorer.hidden = false; }
    const copy = ctx.query<HTMLButtonElement>('[data-detail-copy]'); if (copy) copy.disabled = false;
 ctx.candleWidget?.setMarket({marketId:response.market.marketId,memeAsset:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals});
 ctx.holderWidget?.setMarket({marketId:response.market.marketId,memeToken:response.market.memeToken});
 ctx.tradeHistoryWidget?.setMarket({marketId:response.market.marketId,memeAsset:response.market.memeToken,quoteAsset:response.market.quoteAsset,quoteDecimals:metadata.quoteDecimals});
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("marketId", marketId);
    ctx.router.replaceLocation(nextUrl.href);
    ctx.text("[data-trade-market-name]", metadata.name);
    ctx.text("[data-trade-stock]", shortHex(response.market.assetUid, 9, 7));
    ctx.text('[data-detail-venue]',response.market.launchPhase===0?'Bonding curve':'Uniswap v4');
    void refreshTradeStake();
    if(response.market.gauge===ZERO_ADDRESS)ctx.text('[data-detail-stock-label]','Staking disabled');
    else {const asset=ctx.findAsset(response.market.assetUid);const token=ctx.stockToken(asset);ctx.text('[data-detail-stock-label]',token?shortHex(token):'-');renderDetailStakingSymbol(ctx.stockSymbol(asset),ctx.stockLogo(asset));
      const listed=stakingAssetForConfig(robinhoodChain.id,asset);if(listed)ctx.text('[data-detail-stock-label]',listed.symbol);}

    ctx.displayPriceWidget?.setToken(response.market.quoteAsset);
    ctx.text("[data-trade-quote]", metadata.quoteSymbol);
    ctx.text("[data-trade-phase]", phaseLabel(response.market.launchPhase));
    ctx.text("[data-trade-summary-id]", marketId);
    ctx.text("[data-trade-market-note]", `Real paired-asset reserve ${formatTokenAmount(view.realQuoteReserve, metadata.quoteDecimals)} ${metadata.quoteSymbol}; sellable token amount ${formatTokenAmount(view.sellableTokens, 18)} ${metadata.symbol}.`);
    renderTradeQuote();
    updateTradeAvailability();
    if (ctx.query<HTMLInputElement>("[data-trade-amount]")?.value.trim()) scheduleTradeQuote();
  } catch (error) {
    if (generation !== ctx.tradeLoadGeneration) return;
    clearTradeMarketState();
    ctx.text("[data-detail-phase]", "Market unavailable");
    ctx.query<HTMLElement>('.ref-hero')?.setAttribute('aria-busy','false');
    ctx.tokenDetailWidget?.setUnavailable();
    ctx.text('[data-detail-description]','Token details could not be loaded.');
    ctx.text("[data-detail-phase-note]", publicError(error));
    renderTradeEmptyState("unavailable");
    updateTradeAvailability();
  } finally {
    if(generation===ctx.tradeLoadGeneration)setTradePageLoading(false);
  }
}

async function renderTradeFeeDetails(market: MarketReadModel, generation: number): Promise<void> {
  if(generation!==ctx.tradeLoadGeneration)return;
  renderMarketSettings(document,market);
  const direct=(market as MarketReadModel&{directFeeConfig?:{creatorTaxBps:number;activeStakeRaw:string}}).directFeeConfig;
  const display=market.display;
  const snapshot=direct??(display?{creatorTaxBps:display.creatorTaxBps,activeStakeRaw:display.activeStakeRaw}:null);
  if(!snapshot||market.stakingEnabled===undefined||market.creatorFeesToHolders===undefined||market.lpFeePips===undefined){ctx.tokenDetailWidget?.setFeeConfig(null);return;}
  const baseline=ctx.foundation?.baseline.find(config=>config.id===market.tickerGardenBaselineId);
  if(!baseline){ctx.tokenDetailWidget?.setFeeConfig(null);return;}
  ctx.tokenDetailWidget?.setFeeConfig({phase:market.launchPhase,stakingEnabled:market.stakingEnabled,holders:market.creatorFeesToHolders,active:BigInt(snapshot.activeStakeRaw)>0n,taxBps:snapshot.creatorTaxBps,baseFeeBps:Number(configBigInt(baseline,'curveFeeBps')),lpFeePips:market.lpFeePips});
  const badge=ctx.query<HTMLElement>('[data-detail-staking-badge]');if(badge)badge.hidden=!market.stakingEnabled;
  ctx.text('[data-detail-staking-status]',market.launchPhase===1?'Staking Enabled':'Stake Opens After Blooming');
  ctx.text('[data-detail-creator]',market.creator?shortHex(market.creator):'-');
}

function scheduleTradeQuote(): void {
  window.clearTimeout(ctx.tradeQuoteExpiryTimer);
  window.clearTimeout(ctx.tradeQuoteTimer);
  const generation = ++ctx.tradeQuoteGeneration;
  ctx.tradeQuote = null;
  renderTradeQuote();
  ctx.tradeQuoteTimer = window.setTimeout(() => { void quoteTrade(generation); }, 300);
}

async function refreshTradeQuote():Promise<void>{
  window.clearTimeout(ctx.tradeQuoteExpiryTimer);
  if(ctx.currentPage()!=='trade'||!ctx.tradeQuote||!ctx.wallet||document.hidden||ctx.tradeAutoRefreshPending)return;
  updateTradeAvailability();
  if(ctx.tradeSubmitting){ctx.tradeQuoteExpiryTimer=window.setTimeout(()=>{void refreshTradeQuote();},30000);return;}
  const previous=ctx.tradeQuote;
  ctx.tradeAutoRefreshPending=true;
  const generation=++ctx.tradeQuoteGeneration;
  try{await quoteTrade(generation);}finally{
    ctx.tradeAutoRefreshPending=false;
    if(generation===ctx.tradeQuoteGeneration&&ctx.tradeQuote===previous&&ctx.currentPage()==='trade'&&!document.hidden){
      ctx.tradeQuoteExpiryTimer=window.setTimeout(()=>{void refreshTradeQuote();},30000);
    }
  }
}

async function quoteTrade(generation: number): Promise<void> {
  if (!ctx.tradeMarket || !ctx.tradeMetadata || !ctx.wallet || !ctx.foundation) {
    if (ctx.tradeMarket && !ctx.tradeMarketVerified) ctx.text('[data-trade-status]', 'Verifying Trading Route…');
    updateTradeAvailability();
    return;
  }
  const input = ctx.query<HTMLInputElement>('[data-trade-amount]')?.value.trim() ?? '';
  if (!input) { ctx.text('[data-trade-status]', ''); return; }
  const decimals = ctx.tradeSide === 'buy' ? payment()!.decimals : 18;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(input) || !/[1-9]/.test(input)) {
    ctx.text('[data-trade-status]', 'Enter a valid amount.'); return;
  }
  if ((input.split('.')[1]?.length ?? 0) > decimals) {
    ctx.text('[data-trade-status]', `Use Up To ${decimals} Decimal Places`); return;
  }
  if(!ctx.tradeMarketVerified){await verifyTradeMarket(ctx.tradeMarket,ctx.tradeLoadGeneration);if(!ctx.tradeMarketVerified||generation!==ctx.tradeQuoteGeneration)return;}
  if(ctx.foundation.direct&&ctx.directMarkets){
    const current=ctx.tradeMarket;
    try {
      const fresh=await ctx.directMarkets.market(current.market.marketId);
      if(generation!==ctx.tradeQuoteGeneration||!ctx.tradeMarket||tradeContextKey(ctx.tradeMarket.market)!==tradeContextKey(current.market))return;
      if(fresh.market.launchPhase!==current.market.launchPhase||fresh.market.sourceVersion!==current.market.sourceVersion){await refreshTradeFields(fresh);return;}
    } catch(error){if(generation===ctx.tradeQuoteGeneration)ctx.text('[data-trade-status]','Could Not Load Market. Try Again.');return;}
  }
  if(!ctx.tradeMarket||!ctx.tradeMetadata||!ctx.wallet)return;
  const market = ctx.tradeMarket;
  const metadata = ctx.tradeMetadata;
  const activeWallet = ctx.wallet;
  const side = ctx.tradeSide;
  if (!tradingRoute(market.market.launchPhase, market.market.canonicalRoute)) {
    ctx.text("[data-trade-status]", "Trading Is Temporarily Unavailable");
    updateTradeAvailability();
    return;
  }
  try {
    const amountInput = ctx.required<HTMLInputElement>("[data-trade-amount]").value;
    const asset=payment()!;
    const inputDecimals = side === "buy" ? asset.decimals : 18;
    const payAmount = parseTokenAmount(amountInput, inputDecimals, side === "buy" ? "Payment amount" : "Token input");
    let conversion:ConversionQuote|undefined;
    if(usesConversion()){
      if(!ctx.runtimeConfig.readApi.available)throw Error('Conversion unavailable');
      try{
      conversion=await fetchConversion(ctx.runtimeConfig.readApi.value,{chainId:robinhoodChain.id,sellToken:asset.address,buyToken:canonicalAddress(market.market.quoteAsset,'Paired asset'),sellAmount:String(payAmount),taker:activeWallet.account});
        if(generation===ctx.tradeQuoteGeneration)conversionUnavailableFor=null;
      }catch(error){if(generation===ctx.tradeQuoteGeneration&&ctx.wallet===activeWallet)conversionUnavailableFor=market.market.quoteAsset;throw error;}

      if(generation!==ctx.tradeQuoteGeneration||ctx.wallet!==activeWallet||payment()?.address!==asset.address)return;
      void loadPaymentBalance();
    }
    const amount=conversion?BigInt(conversion.buyAmount):payAmount;
    // Read-only quotes do not need the transaction submission preflight.
    let pricing:CurvePricing|undefined;
    if(market.market.launchPhase===0)pricing=await loadCurvePricing(market.market);
    let quote: TradeQuote;
    let quoteBlock=pricing?.blockNumber;
    if (market.market.launchPhase===1) {
      assertPoolRouterProfile(robinhoodChain.id,poolTradeRoute(market.market,'buy').router);
      const route=poolTradeRoute(market.market,side);
      poolAmount(amount);
      const block=await ctx.publicClient.getBlock({blockTag:'latest'});
      const blockNumber=block.number;quoteBlock=blockNumber;
      const binding=await loadPoolQuoteBindings(market.market,blockNumber);
      // The fee shown and the executable quote use the same block, refreshed together every 30 seconds.
      const [result,slot0]=await Promise.all([
       ctx.publicClient.simulateContract({abi:poolQuoterAbi,address:route.quoter,functionName:'quoteExactInputSingle',args:[{poolKey:route.poolKey,zeroForOne:route.zeroForOne,exactAmount:amount,hookData:'0x'}],account:activeWallet.account,blockNumber}),
       ctx.publicClient.readContract({abi:poolStateAbi,address:binding.manager,functionName:'extsload',args:[poolSlot0(market.market.poolId!)],blockNumber})]);
      const poolProtocolPips=poolProtocolFee(slot0, route.zeroForOne, market.market.poolKey?.fee ?? 0);
      const output=poolAmount(result.result[0]);
      quote=Object.freeze({side,marketId:market.market.marketId,input:amount,output,spent:side==='buy'?amount:null,refund:null,fee:estimatedPoolTradingFee(output,binding.taxBps),poolProtocolPips,feeInMeme:side==='buy',feeEstimated:true,impactBps:poolTradeImpactBps(amount,output,BigInt(slot0)&((1n<<160n)-1n),route.zeroForOne,binding.taxBps,poolProtocolPips,route.poolKey.fee),impactEstimated:true,minimum:quotedMinimum(output),revision:market.sync.revision,expiresAtMs:Date.now()+30_000,transactionDeadline:poolTransactionDeadline(block.timestamp)});
    } else if (side === "buy") {
      const [tokensOut, quoteSpent, refund] = await ctx.publicClient.readContract({
        abi: v1Abis_TickerGardenCurve,
        address: canonicalAddress(market.market.curve, "Curve"),
        functionName: "quoteBuy",
        blockNumber: pricing!.blockNumber,
        args: [amount, activeWallet.account],
        account: activeWallet.account,
      });
      if (tokensOut <= 0n) throw new Error("Curve returned zero token output");
      if(!metadata.deployedAt)throw Error('Launch time missing');
      const elapsed=pricing!.timestamp-BigInt(metadata.deployedAt);
      let exempt=false;
      if(elapsed<5n){const release=ctx.marketRelease(market.market.marketId);const [creator,record]=await Promise.all([
        ctx.publicClient.readContract({address:canonicalAddress(market.market.memeToken,'Token'),abi:v1Abis_TickerMemeTokenV1,functionName:'creator',blockNumber:pricing!.blockNumber}),
        ctx.readWalletMarket(release.marketRegistry,market.market.marketId,pricing!.blockNumber)]);
        exempt=[creator,record.config.creatorRevenueBeneficiaryAtCreation].some(a=>a.toLowerCase()===activeWallet.account.toLowerCase());}
      const fee=curveBuyFee(quoteSpent,pricing!.baseBps,pricing!.taxBps,antiSnipeBps(elapsed,exempt,pricing!.baseBps,pricing!.taxBps));
      const metrics=curveTradeMetrics('buy',amount,tokensOut,quoteSpent,pricing!.quoteReserve,pricing!.tokenReserve,fee);
      quote = Object.freeze({
        side: "buy", marketId: market.market.marketId, input: amount, output: tokensOut,
        spent: quoteSpent, refund, fee, impactBps:metrics.impactBps, minimum: quotedMinimum(tokensOut),
        revision: market.sync.revision, expiresAtMs: Date.now() + 30_000,
      });
    } else {
      const [quoteOut, fee] = await ctx.publicClient.readContract({
        abi: v1Abis_TickerGardenCurve,
        address: canonicalAddress(market.market.curve, "Curve"),
        functionName: "quoteSell",
        blockNumber: pricing!.blockNumber,
        args: [amount],
        account: activeWallet.account,
      });
      if (quoteOut <= 0n) throw new Error("Curve returned zero Quote output");
      quote = Object.freeze({
        side: "sell", marketId: market.market.marketId, input: amount, output: quoteOut,
        spent: null, refund: null, fee, impactBps:curveTradeMetrics('sell',amount,quoteOut,0n,pricing!.quoteReserve,pricing!.tokenReserve,fee).impactBps, minimum: quotedMinimum(quoteOut),
        revision: market.sync.revision, expiresAtMs: Date.now() + 30_000,
      });
    }
    if (
      generation !== ctx.tradeQuoteGeneration
      || ctx.wallet !== activeWallet
      || !ctx.tradeMarket || tradeContextKey(ctx.tradeMarket.market)!==tradeContextKey(market.market)
      || ctx.tradeMetadata !== metadata
      || ctx.tradeSide !== side
    ) return;
    if(conversion&&BigInt(conversion.minBuyAmount)<amount){
      const floor=BigInt(conversion.minBuyAmount);
      const minimum=market.market.launchPhase===0
       ? (await ctx.publicClient.readContract({abi:v1Abis_TickerGardenCurve,address:canonicalAddress(market.market.curve,'Curve'),functionName:'quoteBuy',args:[floor,activeWallet.account],blockNumber:pricing!.blockNumber}))[0]
       : (await ctx.publicClient.simulateContract({abi:poolQuoterAbi,address:poolTradeRoute(market.market,'buy').quoter,functionName:'quoteExactInputSingle',args:[{poolKey:poolTradeRoute(market.market,'buy').poolKey,zeroForOne:poolTradeRoute(market.market,'buy').zeroForOne,exactAmount:floor,hookData:'0x'}],account:activeWallet.account,blockNumber:quoteBlock})).result[0];
      quote=Object.freeze({...quote,minimum:quotedMinimum(minimum)});
      if(generation!==ctx.tradeQuoteGeneration||ctx.wallet!==activeWallet||ctx.tradeMarket?.market.marketId!==market.market.marketId||ctx.tradeSide!==side||payment()?.address!==asset.address)return;
    }
    ctx.tradeQuote = conversion?Object.freeze({...quote,conversion,expiresAtMs:Math.min(quote.expiresAtMs,conversion.expiresAt)}):quote;
    window.clearTimeout(ctx.tradeQuoteExpiryTimer);
    ctx.tradeQuoteExpiryTimer = window.setTimeout(() => { void refreshTradeQuote(); }, Math.max(0, quote.expiresAtMs - Date.now()));
    renderTradeQuote();
  } catch (error) {
    if (generation !== ctx.tradeQuoteGeneration) return;
    const message = ctx.errorText(error);
    ctx.text("[data-trade-status]", /zero .*output/i.test(message) ? 'Amount Too Small' : /insufficient.*(balance|funds)/i.test(message) ? 'Insufficient Balance' : /revert/i.test(message) ? 'Quote Unavailable. Try A Different Amount.' : usesConversion()?`This payment route is unavailable. Try again or pay with ${metadata.quoteSymbol}.`:'Could Not Load Quote. Try Again.');
    updateTradeAvailability();
  }
}

function renderTradeImpact(bps?:bigint,estimated=false):void{
  const node=ctx.query<HTMLElement>('[data-trade-impact]');if(!node)return;
  node.textContent=bps===undefined?'-':`${estimated?'≈ ':''}${bps/100n}.${(bps%100n).toString().padStart(2,'0')}%`;
  node.title=bps===undefined?'':estimated?'Estimated price impact excluding trading fees':'Price impact excluding trading fees';
  node.dataset.impactLevel=bps===undefined||bps<100n?'normal':bps<1000n?'warning':'danger';
}

function renderTradePhase(graduated:boolean):void{
  const label=ctx.query<HTMLElement>('[data-detail-phase]');
  if(!label)return;
  label.classList.toggle('is-bloomed',graduated);
  if(graduated)ctx.iconText('[data-detail-phase]','ph-flower','Bloomed');
  else label.textContent='Growing';
}

function renderTradePoolAddress(market:MarketReadModel):void{
  const node=ctx.query<HTMLElement>('[data-detail-trading-pool]');if(!node)return;
  const value=market.launchPhase===1?market.poolId:market.curve;
  node.replaceChildren(document.createTextNode(market.launchPhase===1?'Uniswap v4 Pool ID: ':'Bonding curve: '));
  if(!value){node.append(document.createTextNode('-'));return;}
  const address=document.createElement('em');address.textContent=shortHex(value);address.title=value;
  const copy=document.createElement('button');copy.type='button';copy.className='trade-pool-copy';
  const label=market.launchPhase===1?'Copy Pool ID':'Copy Curve Address';
  copy.title=label;copy.setAttribute('aria-label',label);
  const icon=document.createElement('i');icon.className='ph ph-copy';icon.setAttribute('aria-hidden','true');copy.append(icon);
  copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(value);icon.className='ph ph-check';copy.title='Copied';copy.setAttribute('aria-label','Copied');}
    catch{icon.className='ph ph-warning-circle';copy.title='Could Not Copy';copy.setAttribute('aria-label','Could Not Copy');}
    window.setTimeout(()=>{icon.className='ph ph-copy';copy.title=label;copy.setAttribute('aria-label',label);},1800);
  };
  node.append(address,copy);
}

function renderTradePrice(value:string|null):void{
  ctx.tokenDetailWidget?.setTradePrice(value);
  const node=ctx.query<HTMLElement>('[data-trade-rate]');if(!node)return;
  if(value===null||!ctx.tradeMetadata){node.textContent='-';node.removeAttribute('title');return;}
  const unit=`${ctx.tradeMetadata.quoteSymbol} / ${ctx.tradeMetadata.symbol}`;
  node.textContent=`${formatTradePrice(value)} ${unit}`;
  node.title=`${value} ${unit}`;
}

function renderTradeQuote(): void {
  const form=ctx.query<HTMLElement>('[data-trade-form]');if(form)form.dataset.refMode=ctx.tradeSide;
  const connect=ctx.query<HTMLButtonElement>('[data-detail-connect]');if(connect)connect.hidden=!!ctx.wallet;
  const conversionFeeRow=ctx.query<HTMLElement>('[data-trade-conversion-fee-row]');if(conversionFeeRow)conversionFeeRow.hidden=!ctx.tradeQuote?.conversion;
  renderPayments();
  void restoreConversion();
  renderDetailBalances();
  const inputAsset = ctx.query<HTMLElement>("[data-trade-input-asset]");
  const outputAsset = ctx.query<HTMLElement>("[data-trade-output-asset]");
  if (inputAsset) inputAsset.textContent = ctx.tradeSide === "buy" ? payment()?.symbol ?? "Paired asset" : ctx.tradeMetadata?.symbol ?? "Token";
  if (outputAsset) outputAsset.textContent = ctx.tradeSide === "buy" ? ctx.tradeMetadata?.symbol ?? "Token" : ctx.tradeMetadata?.quoteSymbol ?? "Paired asset";
  const quoteLogo=ctx.tradeMetadata?quoteIconUrl(ctx.tradeMetadata.quoteSymbol):undefined;
  renderTradeAssetLogo('[data-trade-input-logo]',ctx.tradeSide==='buy'?quoteIconUrl(payment()?.symbol??''):ctx.tradeMemeLogoUrl,ctx.tradeSide==='buy'?(ctx.tradeMetadata?.quoteSymbol??'Paired asset'):(ctx.tradeMetadata?.symbol??'Token'));
  renderTradeAssetLogo('[data-trade-output-logo]',ctx.tradeSide==='buy'?ctx.tradeMemeLogoUrl:quoteLogo,ctx.tradeSide==='buy'?(ctx.tradeMetadata?.symbol??'Token'):(ctx.tradeMetadata?.quoteSymbol??'Paired asset'));
  const submit = ctx.query<HTMLButtonElement>("[data-trade-submit]");
  if (submit) {
    submit.className = `action-button ${ctx.tradeSide}`;
    submit.hidden=!ctx.wallet;
    submit.textContent = `${ctx.tradeSide === "buy" ? "Buy" : "Sell"}${ctx.tradeMetadata?.symbol ? ` ${ctx.tradeMetadata.symbol}` : ""}`;
  }
  if (!ctx.tradeQuote || !ctx.tradeMetadata) {
    const poolFees=ctx.query<HTMLElement>("[data-trade-pool-fees]");if(poolFees)poolFees.hidden=true;
    ctx.text("[data-trade-output]", "-");
    ctx.query<HTMLOutputElement>('[data-trade-output]')?.removeAttribute('title');
    const pricing=ctx.curvePricing?.marketId===ctx.tradeMarket?.market.marketId?ctx.curvePricing:null;
    renderTradePrice(pricing&&pricing.tokenReserve>0n&&ctx.tradeMetadata?formatUnits(pricing.quoteReserve*10n**18n/pricing.tokenReserve,ctx.tradeMetadata.quoteDecimals):null);
    ctx.text("[data-trade-fee]", "-");
    renderTradeImpact();
    ctx.text("[data-trade-minimum]", "-");
    ctx.text("[data-trade-status]", ctx.wallet ? "" : "Connect Your Wallet");
    updateTradeAvailability();
    return;
  }
  const outputDecimals = ctx.tradeQuote.side === "buy" ? 18 : ctx.tradeMetadata.quoteDecimals;
  const outputSymbol = ctx.tradeQuote.side === "buy" ? ctx.tradeMetadata.symbol : ctx.tradeMetadata.quoteSymbol;
  ctx.text("[data-trade-output]", formatTokenAmount(ctx.tradeQuote.output, outputDecimals));
  const outputNode=ctx.query<HTMLOutputElement>('[data-trade-output]');if(outputNode)outputNode.title=formatUnits(ctx.tradeQuote.output,outputDecimals);
  const meme=ctx.tradeQuote.side==='buy'?ctx.tradeQuote.output:ctx.tradeQuote.input;
  const quoteAmount=ctx.tradeQuote.side==='buy'?(ctx.tradeQuote.spent??ctx.tradeQuote.input):ctx.tradeQuote.output;
  renderTradePrice(formatUnits(quoteAmount*10n**18n/meme,ctx.tradeMetadata.quoteDecimals));
  const feeDecimals=ctx.tradeQuote.feeInMeme?18:ctx.tradeMetadata.quoteDecimals;
  const feeSymbol=ctx.tradeQuote.feeInMeme?ctx.tradeMetadata.symbol:ctx.tradeMetadata.quoteSymbol;
  ctx.text("[data-trade-fee]", ctx.tradeQuote.fee===null?"-":`${ctx.tradeQuote.feeEstimated?'≈ ':''}${formatUnits(ctx.tradeQuote.fee,feeDecimals)} ${feeSymbol}`);
  const poolFees=ctx.query<HTMLElement>("[data-trade-pool-fees]");
  if(poolFees){poolFees.hidden=ctx.tradeQuote.poolProtocolPips===undefined;poolFees.textContent=ctx.tradeQuote.poolProtocolPips===undefined?'':formatPoolFeeSummary(ctx.tradeMarket?.market.poolKey?.fee??0,ctx.tradeQuote.poolProtocolPips);}

  renderTradeImpact(ctx.tradeQuote.impactBps,ctx.tradeQuote.impactEstimated);
  if(ctx.tradeQuote.conversion){
    const q=ctx.tradeQuote.conversion,pay=payment()!;
    ctx.text('[data-trade-impact]',`Market: ${ctx.tradeQuote.impactBps===undefined?'-':`${Number(ctx.tradeQuote.impactBps)/100}%`} · Conversion: -`);
    ctx.text('[data-trade-conversion-fee]',conversionFeeLabel(q));
    const rate=ctx.query<HTMLElement>('[data-trade-rate]');if(rate){const value=formatUnits(BigInt(q.sellAmount)*10n**18n/ctx.tradeQuote.output,pay.decimals);rate.textContent=`${formatTradePrice(value)} ${pay.symbol} / ${ctx.tradeMetadata.symbol}`;rate.title=`${value} ${pay.symbol} / ${ctx.tradeMetadata.symbol}`;}
  }

  ctx.text("[data-trade-minimum]", `${formatUnits(ctx.tradeQuote.minimum, outputDecimals)} ${outputSymbol}`);
  ctx.text("[data-trade-status]", "");
  updateTradeAvailability();
}

function updateTradeAvailability(): void {
  renderStockPurchaseHint();
  const submit = ctx.query<HTMLButtonElement>("[data-trade-submit]");
  if (!submit) return;
  const quoteFresh = Boolean(
    ctx.tradeQuote
    && ctx.tradeQuote.expiresAtMs > Date.now()
    && ctx.tradeMarket
    && ctx.tradeQuote.marketId === ctx.tradeMarket.market.marketId
    && ctx.tradeQuote.side === ctx.tradeSide,
  );
  const routeReady = ctx.tradeMarketVerified && ctx.tradeMarket && tradingRoute(ctx.tradeMarket.market.launchPhase, ctx.tradeMarket.market.canonicalRoute);
  const balance = ctx.detailBalanceAccount === ctx.wallet?.account ? (ctx.tradeSide === 'buy' ? ctx.detailBalances?.quote : ctx.detailBalances?.meme) : undefined;
  const payBalance=usesConversion()?(paymentBalance&&paymentBalance.account===ctx.wallet?.account&&paymentBalance.token===payment()?.address?paymentBalance.value:undefined):balance;
  const insufficient = !!ctx.tradeQuote && payBalance !== undefined && (ctx.tradeQuote.conversion?BigInt(ctx.tradeQuote.conversion.sellAmount):ctx.tradeQuote.input)>payBalance;
  const marketId=ctx.tradeMarket?.market.marketId;
  const blocked=marketId?ctx.transactionScopeBusy({businessType:'trade',marketId,conflictKey:`trade:${marketId}`}):false;
  const loading=(ctx.tradeSubmitting&&ctx.tradeSubmittingMarketId===marketId)||blocked;
  submit.classList.toggle('is-loading',loading);submit.setAttribute('aria-busy',String(loading));
  if(loading){submit.replaceChildren();const spinner=document.createElement('i');spinner.className='ph ph-spinner-gap trade-tx-spinner';spinner.setAttribute('aria-hidden','true');submit.append(spinner,document.createTextNode(ctx.tradeSubmittingLabel));}
  else submit.textContent=`${ctx.tradeSide==='buy'?'Buy':'Sell'}${ctx.tradeMetadata?.symbol?` ${ctx.tradeMetadata.symbol}`:''}`;
  ctx.setDisabled(submit, loading || !ctx.writeReady() || !quoteFresh || !routeReady || insufficient || (usesConversion()&&payBalance===undefined) || (!!recovery&&recovery.state!=='funded'));
  if (insufficient) ctx.text('[data-trade-status]', `Insufficient ${ctx.tradeSide === 'buy' ? payment()?.symbol ?? 'Balance' : ctx.tradeMetadata?.symbol ?? 'Balance'}`);
}

async function refreshRecentTrades(force=false):Promise<void>{
 await ctx.tokenDetailWidget?.refresh(force);
}

function showReceiptTrades(_receipt:TransactionReceipt,_market:MarketReadModel,_decimals:number,_poolManager?:string):void{
 // Receipt verification belongs to the wallet flow. Historical rows wait for
 // the backend indexer to publish the transaction to its database.
 ctx.tokenDetailWidget?.receipt(_receipt.transactionHash);
}

async function refreshTradeFields(fresh?:MarketDetailResponse,background=false,stakeChanged=false):Promise<void>{
 if(!background&&recovery?.state!=='funded')recoveryIdentity="";
 const current=ctx.tradeMarket,own=++ctx.tradeFieldsGeneration,page=ctx.routeGeneration;
 if(!current||!ctx.foundation||(!ctx.readApi&&!(ctx.foundation.direct&&ctx.directMarkets)))return;
 try{
  const response=fresh??(ctx.foundation.direct&&ctx.directMarkets?await ctx.directMarkets.market(current.market.marketId):await ctx.readApi!.getMarketPageBootstrap({marketId:current.market.marketId}));
  if(own!==ctx.tradeFieldsGeneration||page!==ctx.routeGeneration||ctx.tradeMarket!==current||response.market.marketId!==current.market.marketId||response.market.memeToken!==current.market.memeToken)return;
  if(marketIdentityPending(response.market))return;
  if(current.market.confirmation&&!response.market.confirmation&&BigInt(response.market.display?.blockNumber??'0')<BigInt(current.market.display?.blockNumber??'0'))return;
  ctx.tradeMarket=response;
  const changed=tradeContextKey(response.market)!==tradeContextKey(current.market);
  if(changed){
    ++ctx.tradeLoadGeneration; ++ctx.tradeQuoteGeneration;
    ctx.verifiedMarketReleases.delete(current.market.marketId);ctx.verifiedMarketRuntime.delete(current.market.marketId);
    ctx.tradeMarketVerified=false;
  }
  const view=toCurveProgressViewModel(response),graduated=response.market.launchPhase===1;
  const baseline=ctx.foundation.baseline.find(c=>c.id===response.market.tickerGardenBaselineId),supply=baseline?.values.supply;
  renderTradePhase(graduated);
  for(const selector of ['[data-detail-progress-label]','[data-detail-graduation]']){const node=ctx.query<HTMLElement>(selector);if(node)node.hidden=graduated;}
  const progress=ctx.marketBloomProgress(response.market);
  ctx.text('[data-detail-progress-label]',progress===null?'-':`${progress.toFixed(2)}%`);
  const bar=ctx.query<HTMLProgressElement>('[data-detail-progress]');if(bar){if(progress===null)bar.removeAttribute('value');else bar.value=progress;}
  renderTradePoolAddress(response.market);
  ctx.text('[data-detail-venue]',graduated?'Uniswap v4':'Bonding curve');
  ctx.text('[data-detail-phase-note]','');
  ctx.curvePricing=null;
  // Keep identity, metadata, chart selection and existing statistics mounted.
  if(!background)void loadDetailBalances(true);
  if(stakeChanged||changed||response.market.display?.totalStakedRaw!==current.market.display?.totalStakedRaw||response.market.display?.activeStakeRaw!==current.market.display?.activeStakeRaw)void refreshTradeStake();
  // A transient RPC failure must recover even when the market revision stays
  // unchanged. Trading remains locked until canonical verification succeeds.


  if(own!==ctx.tradeFieldsGeneration||page!==ctx.routeGeneration||ctx.tradeMarket!==response)return;
  if(!background || changed)ctx.overviewLoads.delete(response.market.marketId);
  void refreshMarketOverview(!background || changed);
  if(response.market.content!==current.market.content)void loadDetailContent(response.market,ctx.tradeLoadGeneration);
  if(!background || changed){
    ctx.tradeQuote=null;renderTradeQuote();
    if(ctx.query<HTMLInputElement>('[data-trade-amount]')?.value.trim())scheduleTradeQuote();
  }else if(!ctx.tradeQuote){
    renderTradeQuote();
    if(ctx.query<HTMLInputElement>('[data-trade-amount]')?.value.trim())scheduleTradeQuote();
  }
 }catch{/* A display refresh must never turn a confirmed trade into an error. */}
}

function completeTradeDisplay(market:MarketDetailResponse):void{
 if(ctx.tradeSide==='buy'&&recovery?.marketId===market.market.marketId&&recovery.account===ctx.wallet?.account&&['funded','buy_pending','buy_submitting'].includes(recovery.state))saveRecovery(null);
 if(!ctx.tradeMarket||ctx.tradeMarket.market.marketId!==market.market.marketId||ctx.tradeMarket.market.memeToken!==market.market.memeToken||ctx.tradeMarket.market.quoteAsset!==market.market.quoteAsset)return;
 ctx.directMarkets?.cache.delete(market.market.marketId);
 window.clearTimeout(ctx.tradeQuoteExpiryTimer);window.clearTimeout(ctx.tradeQuoteTimer);++ctx.tradeQuoteGeneration;
 const input=ctx.query<HTMLInputElement>('[data-trade-amount]');if(input)input.value='';
 ctx.tradeQuote=null;renderTradeQuote();
 // The receipt changed both wallet assets. Cancel any pre-receipt reads and
 // refresh balances independently of the market-data service.
 void loadDetailBalances(false);
 void refreshTradeFields();
}

async function convertPayment(initial:TradeQuote,market:MarketDetailResponse,wallet:WalletState):Promise<TradeQuote>{
 const original=initial.conversion!;
 let executable=original;
 if(recovery&&recovery.state!=='funded')throw Error('Check the existing conversion before trying again.');
 const verify=async()=>{await ctx.verifyLiveWalletContext(wallet);if(ctx.tradeMarket?.market.marketId!==market.market.marketId||ctx.tradeSide!=='buy')throw Error('Trade changed');await ctx.ensureCanonicalMarket(market.market);
 const target=conversionSettler(executable).toLowerCase();
 const current=await ctx.publicClient.readContract({address:SETTLER_REGISTRY,abi:registryAbi,functionName:'ownerOf',args:[2n]});
 if(current.toLowerCase()!==target){const prev=await ctx.publicClient.readContract({address:SETTLER_REGISTRY,abi:registryAbi,functionName:'prev',args:[2n]});if(prev.toLowerCase()!==target)throw Error('Payment route changed. Try again.');}
 };
 await verify();
 if(original.sellToken!==TRADE_NATIVE){
   await ctx.ensureStandaloneApproval({abi:erc20Abi,address:original.sellToken,functionName:'approve',args:[ALLOWANCE_HOLDER,BigInt(original.sellAmount)]},original.sellToken,ALLOWANCE_HOLDER,BigInt(original.sellAmount),market.sync,verify,wallet,{businessType:'approval',marketId:market.market.marketId,conflictKey:`trade:${market.market.marketId}`});
 }
 if(!ctx.runtimeConfig.readApi.available)throw Error('Conversion unavailable');
 const fresh=preserveConversionMinimum(await fetchConversion(ctx.runtimeConfig.readApi.value,original),original);
 executable=fresh;
 await verify();
 const request=conversionRequest(fresh,original);
 const scope={businessType:'trade' as const,marketId:market.market.marketId,conflictKey:`trade:${market.market.marketId}`};
 const saved:ConversionRecovery={account:wallet.account,marketId:market.market.marketId,pair:original.buyToken,amount:original.minBuyAmount,minimum:String(initial.minimum),state:'submitting'};
 const nativeBefore=original.buyToken===TRADE_NATIVE?await ctx.publicClient.getBalance({address:wallet.account}):0n;
 // Persistence must work BEFORE opening a wallet. Never silently lose a funded or uncertain conversion.
 saveRecovery(saved);
 let sent=false,signatureRequested=false,funded=false,purchasedAmount=BigInt(original.minBuyAmount);
 try{
  await ctx.executeTransaction({operationKey:`trade:conversion:${market.market.marketId}:${Date.now()}`,scope,sync:market.sync,request,walletContext:wallet,quoteExpiresAtMs:fresh.expiresAt,verifyChain:verify,
   onUpdate:update=>{if(update.stage==='awaiting_signature')signatureRequested=true;if(update.hash){sent=true;if(!funded)saveRecovery({...saved,state:'pending',hash:update.hash});}ctx.tradeSubmittingLabel='Exchanging payment…';updateTradeAvailability();},
   confirm:async receipt=>{
    if(receipt.status!=='success')throw Error('Conversion failed');
    let received=BigInt(fresh.minBuyAmount);
    if(original.buyToken!==TRADE_NATIVE){let net=0n;for(const log of receipt.logs){if(log.address.toLowerCase()!==original.buyToken.toLowerCase())continue;try{const event=decodeEventLog({abi:erc20Abi,data:log.data,topics:log.topics});if(event.eventName==='Transfer'){if(event.args.to.toLowerCase()===wallet.account.toLowerCase())net+=event.args.value;if(event.args.from.toLowerCase()===wallet.account.toLowerCase())net-=event.args.value;}}catch{}}
     if(net>=received)received=net;
    }else{const after=await ctx.publicClient.getBalance({address:wallet.account,blockNumber:receipt.blockNumber});const delta=after-nativeBefore+receipt.gasUsed*receipt.effectiveGasPrice;if(delta>=received)received=delta;}
    // Consume at most the reviewed expected amount; retain positive surplus in the wallet.
    const cap=BigInt(original.buyAmount);if(received>cap)received=cap;
    saveRecovery({...saved,amount:String(received),state:'funded',hash:receipt.transactionHash});funded=true;purchasedAmount=received;return true;
   }});
 }catch(error){const code=(error as {code?:string})?.code;
  if(!sent&&!signatureRequested)saveRecovery(null,saved);
  if(!sent&&['user_rejected','simulation_failed','stale_quote','stale_snapshot','wrong_account','unsupported_chain'].includes(code??''))saveRecovery(null,saved);
  if(code==='transaction_reverted'||code==='replacement_cancelled')saveRecovery(null,saved);
  throw error;
 }
 // Receipt-confirmed payment, bounded by the user's reviewed amount.
 await verify();
 const received=purchasedAmount;
 selectedPayment=market.market.quoteAsset;paymentBalance=null;
 const field=ctx.query<HTMLInputElement>('[data-trade-amount]');if(field)field.value=formatUnits(received,ctx.tradeMetadata!.quoteDecimals);
 await loadDetailBalances();
 ctx.tradeQuote=null;
 await quoteTrade(++ctx.tradeQuoteGeneration);
 const next=ctx.tradeQuote as TradeQuote|null;
 if(!next||next.conversion||next.side!=='buy'||next.input!==received||next.marketId!==initial.marketId)throw Error('Conversion complete. Refresh the quote to continue with your paired asset.');
 const minimum=approvedQuoteMinimum(initial,next);
 renderPayments();return Object.freeze({...next,minimum});
}

async function executeProjectTrade(input:Parameters<ControllerContext['executeTransaction']>[0]){
 const saved=recovery;
 if(ctx.tradeSide!=='buy'||!saved||saved.state!=='funded'||saved.account!==ctx.wallet?.account||saved.marketId!==ctx.tradeMarket?.market.marketId)return ctx.executeTransaction(input);
 const progress:ConversionRecovery={...saved,state:'buy_submitting',buyTo:input.request.address,buyHash:undefined};
 saveRecovery(progress);let signed=false,sent=false,complete=false;
 try{return await ctx.executeTransaction({...input,onUpdate:update=>{
   input.onUpdate?.(update);if(update.stage==='awaiting_signature')signed=true;
   if(update.hash&&!update.stage.includes('approval')){sent=true;if(!complete)saveRecovery({...progress,state:'buy_pending',buyHash:update.hash});}
  },confirm:async(receipt,hash)=>{const result=await input.confirm(receipt,hash);saveRecovery(null,progress);complete=true;return result;}});
 }catch(error){const code=(error as {code?:string}).code;
  if((!sent&&!signed)||['user_rejected','simulation_failed','stale_quote','stale_snapshot','transaction_reverted','replacement_cancelled'].includes(code??''))saveRecovery(saved);
  throw error;
 }
}

async function submitTrade(): Promise<void> {
  if(ctx.tradeSubmitting)return;
  ctx.tradeSubmitting=true;const inputField=ctx.query<HTMLInputElement>('[data-trade-amount]');if(inputField)inputField.readOnly=true;renderPayments();ctx.tradeSubmittingMarketId=ctx.tradeMarket?.market.marketId;ctx.tradeSubmittingLabel='Preparing…';updateTradeAvailability();
  try {
    if (!ctx.foundation || !ctx.wallet || !ctx.tradeMarket || !ctx.tradeQuote) throw new Error("Connect a wallet, load a Curve market and request a fresh quote");
    if (!ctx.tradeMarketVerified) throw new Error("The canonical trading route is still being verified");
    const activeWallet = ctx.wallet;
    const market = ctx.tradeMarket;
    if(recovery&&recovery.state!=='funded')throw Error('Check the existing conversion transaction before buying again.');
    let quote = Object.freeze({...ctx.tradeQuote,minimum:ctx.tradeQuote.conversion?ctx.tradeQuote.minimum:quotedMinimum(ctx.tradeQuote.output)});
    const side = ctx.tradeSide;
    await ctx.verifyLiveWalletContext(activeWallet);
    if (quote.expiresAtMs <= Date.now() || quote.side !== side || quote.marketId !== market.market.marketId) {
      throw new Error("The quote expired or no longer matches the form");
    }
    const metadata = ctx.tradeMetadata;
    if (!metadata) throw new Error("Trade metadata is unavailable");
    const currentInput = parseTokenAmount(
      ctx.required<HTMLInputElement>("[data-trade-amount]").value,
      side === "buy" ? payment()!.decimals : 18,
      side === "buy" ? "Paired-asset input" : "Token input",
    );
    if (currentInput !== (quote.conversion?BigInt(quote.conversion.sellAmount):quote.input)) {
      throw new Error("The trade form changed after quoting; request a fresh quote");
    }
    if (!tradingRoute(market.market.launchPhase, market.market.canonicalRoute)) throw new Error("Trading route changed. Refresh the market and quote.");
    const pay=payment()!;
    const confirmationPay=quote.conversion?`${formatUnits(BigInt(quote.conversion.sellAmount),pay.decimals)} ${pay.symbol}`:`${formatUnits(quote.input,side==='buy'?metadata.quoteDecimals:18)} ${side==='buy'?metadata.quoteSymbol:metadata.symbol}`;
    if(!await ctx.confirmFlowAction(`${side==='buy'?'Buy':'Sell'} ${metadata.symbol}\nPay: ${confirmationPay}\n${quote.conversion?`Route: ${pay.symbol} → ${metadata.quoteSymbol} → ${metadata.symbol}\nConversion minimum (1% tolerance): ${formatUnits(BigInt(quote.conversion.minBuyAmount),metadata.quoteDecimals)} ${metadata.quoteSymbol}\nConversion fee: ${conversionFeeLabel(quote.conversion)}\n`:''}Market price impact: ${quote.impactBps===undefined?'-':`${Number(quote.impactBps)/100}%`}\nMinimum received: ${formatUnits(quote.minimum,side==='buy'?18:metadata.quoteDecimals)} ${side==='buy'?metadata.symbol:metadata.quoteSymbol}`,{title:'Confirm trade',confirmLabel:'Confirm trade'}))return;
    await ctx.verifyLiveWalletContext(activeWallet);
    if(ctx.tradeMarket!==market||ctx.tradeSide!==side||payment()?.address!==pay.address)throw Error('Trade changed. Review the current quote.');
    const [eth,reserve,fees]=await Promise.all([ctx.publicClient.getBalance({address:activeWallet.account}),tradeNetworkReserve(market,quote,activeWallet.account),ctx.publicClient.estimateFeesPerGas()]);
    const conversionGas=quote.conversion?gasReserve(2_000_000n,fees.maxFeePerGas??fees.gasPrice??0n):0n;
    const inputValue=quote.conversion?(quote.conversion.sellToken===TRADE_NATIVE?BigInt(quote.conversion.sellAmount):0n):side==='buy'&&market.market.quoteAsset===ZERO_ADDRESS?quote.input:0n;
    if(eth<inputValue+reserve+conversionGas){ctx.text('[data-trade-status]','Keep enough ETH for the network fee.');return;}
    if(quote.conversion){quote=await convertPayment(quote,market,activeWallet);ctx.tradeQuote=quote;}
    if(market.market.launchPhase===1){await submitPoolTrade(market,quote,activeWallet);return;}
    const curve = canonicalAddress(market.market.curve, "Curve");
    const account = activeWallet.account;
    const built = side === "buy"
      ? buildCurveBuyRequest({ marketResponse: market, quoteIn: quote.input, minTokensOut: quote.minimum, recipient: account })
      : buildCurveSellRequest({ marketResponse: market, tokensIn: quote.input, minQuoteOut: quote.minimum, recipient: account });
    const inputToken = side === "buy" ? built.view.quoteAsset : built.view.memeToken;
    const approval = await ctx.allowanceApproval(built.approval, inputToken, curve, quote.input, account);
    await executeProjectTrade({
      operationKey: `trade:${quote.side}:${quote.marketId}:${quote.input}:${quote.revision}`,
      sync: market.sync,
      request: built.request,
      ...(approval ? { approval } : {}),
      quoteExpiresAtMs: quote.expiresAtMs,
      walletContext: activeWallet,
      verifyChain: () => ctx.ensureCanonicalMarket(market.market),
      confirm: async (receipt) => {
        if (quote.side === "buy") {
          ctx.receiptEvent(receipt, curve, v1Abis_TickerGardenCurve, "CurveBuy", (args) =>
            String(args.buyer).toLowerCase() === account
            && String(args.recipient).toLowerCase() === account
            && typeof args.quoteIn === "bigint"
            && args.quoteIn > 0n
            && args.quoteIn <= quote.input
            && typeof args.tokensOut === "bigint"
            && args.tokensOut >= quote.minimum,
          );
        } else {
          ctx.receiptEvent(receipt, curve, v1Abis_TickerGardenCurve, "CurveSell", (args) =>
            String(args.seller).toLowerCase() === account
            && String(args.recipient).toLowerCase() === account
            && args.tokensIn === quote.input
            && typeof args.quoteOut === "bigint"
            && args.quoteOut >= quote.minimum,
          );
        }
        showReceiptTrades(receipt,market.market,metadata.quoteDecimals);
        return true;
      },
    });
    completeTradeDisplay(market);
  } catch (error) {
    ctx.notify(recovery?.state==='funded'?'Conversion complete. Your paired asset is in your wallet. Refresh the quote and continue buying.':publicError(error,'transaction'), "warning");
  } finally {ctx.tradeSubmitting=false;if(inputField)inputField.readOnly=false;ctx.tradeSubmittingMarketId=undefined;renderPayments();updateTradeAvailability();}
}

async function submitPoolTrade(market:MarketDetailResponse,initial:TradeQuote,activeWallet:WalletState):Promise<void>{
  assertPoolRouterProfile(robinhoodChain.id,poolTradeRoute(market.market,'buy').router);
  const route=poolTradeRoute(market.market,initial.side),account=activeWallet.account;
  const verify=()=>ctx.ensureCanonicalMarket(market.market);
  const [manager,quoterManager,vaultManager]=await Promise.all([
    ctx.publicClient.readContract({abi:poolRouterAbi,address:route.router,functionName:'poolManager'}),
    ctx.publicClient.readContract({abi:poolQuoterAbi,address:route.quoter,functionName:'poolManager'}),
    ctx.publicClient.readContract({abi:v1Abis_ProtocolFeeVault,address:ctx.marketRelease(market.market.marketId).feeVault,functionName:'poolManager'}),
  ]);
  if(manager.toLowerCase()!==quoterManager.toLowerCase()||manager.toLowerCase()!==vaultManager.toLowerCase()||manager===ZERO_ADDRESS)throw Error('External trading services do not match the protocol PoolManager');
  if(route.input!==ZERO_ADDRESS){
    await ctx.ensureStandaloneApproval({abi:erc20Abi,address:route.input,functionName:'approve',args:[PERMIT2,initial.input]},route.input,PERMIT2,initial.input,market.sync,verify,activeWallet,{businessType:'approval',marketId:market.market.marketId,conflictKey:`trade:${market.market.marketId}`});
    const [allowanceBlock,[allowance,expiration]]=await Promise.all([
      ctx.publicClient.getBlock({blockTag:'latest'}),
      ctx.publicClient.readContract({abi:permit2Abi,address:PERMIT2,functionName:'allowance',args:[account,route.input,route.router]}),
    ]);
    if(allowance<initial.input||!poolPermit2AllowanceFresh(expiration,allowanceBlock.timestamp)){
      const expiry=poolPermit2Expiration(allowanceBlock.timestamp);
      await ctx.executeTransaction({operationKey:`pool-approval:${market.market.marketId}:${initial.input}:${expiry}`,sync:market.sync,request:{abi:permit2Abi,address:PERMIT2,functionName:'approve',args:[route.input,route.router,initial.input,expiry]},walletContext:activeWallet,verifyChain:verify,confirm:async receipt=>{
        const [amount,until]=await ctx.publicClient.readContract({abi:permit2Abi,address:PERMIT2,functionName:'allowance',args:[account,route.input,route.router],blockNumber:receipt.blockNumber});
        if(amount<initial.input||until!==expiry)throw Error('Pool spending approval was not confirmed');return true;
      }});
    }
  }
  // Approvals may take longer than the quote window. Always refresh before signing the swap.
  await quoteTrade(++ctx.tradeQuoteGeneration);
  const quote=ctx.tradeQuote;
  if(ctx.wallet!==activeWallet||ctx.tradeMarket!==market||!quote||quote.input!==initial.input||quote.side!==initial.side)throw Error('Trade changed during approval. Review the new quote.');
  let minimum:bigint;
  try{minimum=approvedQuoteMinimum(initial,quote);}catch{ctx.text('[data-trade-status]','Price changed. Review the updated quote and submit again.');return;}
  if(quote.transactionDeadline===undefined)throw Error('Pool transaction deadline is unavailable. Refresh the quote.');
  ctx.tradeQuote=Object.freeze({...quote,minimum});renderTradeQuote();
  const request=buildPoolTrade(market.market,quote.side,quote.input,minimum,quote.transactionDeadline);
  await executeProjectTrade({operationKey:`pool-trade:${quote.side}:${quote.marketId}:${quote.input}:${quote.expiresAtMs}`,sync:market.sync,request,quoteExpiresAtMs:quote.expiresAtMs,walletContext:activeWallet,verifyChain:verify,confirm:async receipt=>{
    try {
      ctx.receiptEvent(receipt,canonicalAddress(manager,'PoolManager'),poolSwapAbi,'Swap',args=>String(args.id).toLowerCase()===market.market.poolId&&String(args.sender).toLowerCase()===route.router.toLowerCase()&&typeof args.amount0==='bigint'&&typeof args.amount1==='bigint'&&(route.zeroForOne?args.amount0<0n&&args.amount1>0n:args.amount1<0n&&args.amount0>0n));
    } catch (error) {
      if(!ctx.foundation?.direct)throw error;
      // The local deterministic PoolManager boundary emits the protocol hook's
      // fully-accounted fee event instead of a production Uniswap Swap event.
      ctx.receiptEvent(receipt,route.poolKey.hooks,v1Abis_TickerGardenMemeHook,'V4FeeAccrued',args=>args.marketId===market.market.marketId&&args.poolId===market.market.poolId&&String(args.feeAsset).toLowerCase()===route.output&&typeof args.totalFee==='bigint'&&args.totalFee>0n&&typeof args.lpAmount==='bigint'&&typeof args.nonLpAmount==='bigint'&&args.lpAmount+args.nonLpAmount===args.totalFee);
    }
    showReceiptTrades(receipt,market.market,ctx.tradeMetadata?.quoteDecimals??18,manager);
    ctx.directMarkets?.receipt(receipt);return true;
  }});
  const input=ctx.query<HTMLInputElement>('[data-trade-amount]');if(input)input.value='';
  completeTradeDisplay(market);
}
return {renderDetailBalances,updateTradeAvailability,refreshTradeStake,loadDetailBalances,retryMissingDetailBalances,refreshTradeQuote,completeTradeDisplay,refreshTradeFields,loadTradeMarket,clearTradeMarketState,setTradePageLoading,setupTrade};
}
