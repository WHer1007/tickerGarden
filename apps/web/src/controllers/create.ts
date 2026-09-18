import {savedLaunchTransaction,clearVerifiedLaunchTransaction,recoveryRead,recoveryRemove,recoveryWrite} from '../v1/recoveryStorage.ts';
import {failedLaunchState} from '../create/launch-state.ts';
import {waitForLaunchData} from '../create/launch-readiness.ts';
import {recordLaunchFailure,launchFailureMessage,launchErrorCode,type LaunchOperation} from '../create/launch-diagnostics.ts';
import {createConfirmationAsset} from '../create/confirmation-asset.ts';
import {quoteIconUrl} from '../create/quote-icons.ts';
import {createPurchaseNotice} from '../create/purchase-notice.ts';
import {fetchPurchaseQuote,purchaseRequest,purchaseEthLimit,assertPurchaseWithinApproval,type PurchaseQuote} from '../create/quote-purchase.ts';
import {FIXED_LAUNCH_FEE_LABEL} from '../create/launch-fee-display.ts';
import {sortStakingAssets,sortPairedAssets} from '../create/featured-stocks.ts';
import { publicError } from "../ui/public-error.ts";
import currentV4Abis_TickerGardenFactoryV1 from '../v1/generated/contracts/current/TickerGardenFactoryV1.ts';
import v1Abis_TickerGardenCurve from '../v1/generated/contracts/legacy/TickerGardenCurve.ts';
import {
encodeFunctionData,
formatUnits,
keccak256,
parseEventLogs,
erc20Abi,
type Address,
type Hash,
type Hex,
type TransactionReceipt
} from "viem";
import { confirmLaunch } from "../create/confirm-launch.ts";
import { developerBuyNotice } from "../create/developer-buy.ts";
import { clearCreateDraft,readCreateDraft,writeCreateDraft } from "../create/draft.ts";
import { developerBuyMode,graduationAmount,graduationEconomics } from "../create/economics.ts";
import { feePreviewTable } from "../create/fee-preview.ts";
import { ipfsGatewayURL,isIPFSFileURI } from "../create/ipfs.ts";
import { assertRecoveredLaunchReceipt } from "../create/launch-confirmation.ts";
import { closeLaunchProgress,finishLaunchProgress,renderLaunchProgress } from "../create/launch-progress-dialog.ts";
import { launchPhaseDisplay,launchStateKey,readLaunchState,saveLaunchState,type LaunchPhase,type LaunchState } from "../create/launch-state.ts";
import { parseSavedListing } from "../create/listing-package.ts";
import { renderListingPanel } from "../create/listing-panel.ts";
import { canResumeUpload,publishLaunchDetails,readTokenImage } from "../create/metadata.ts";
import { assertCreatorTaxSupported,creatorTaxBps } from "../create/options.ts";
import { activePairedConfig,isQuoteSelectionPaused,RELEASE_PAIRED_ASSETS,RELEASE_SUPPLY,releasePairForSelection } from "../create/paired-assets.ts";
import { launchPreviewField } from "../create/preview-dependencies.ts";
import { updateQuotePicker,type QuotePickerOption } from "../create/quote-picker.ts";
import { isListedStakingAsset,stakingAssetForConfig } from "../create/staking-assets.ts";
import { authorizeUpload } from "../create/upload-auth.ts";
import {
canonicalAddress,
canonicalBytes32,
configBigInt,
configNumber,
configString,
formatTokenAmount,
parseTokenAmount,
shortHex,
tupleField,
ZERO_ADDRESS
} from "../runtime/model.ts";
import { fieldError } from "../ui/fieldValidation.ts";
import { robinhoodChain } from "../v1/chain.ts";
import { createDisabledLevel,createDisabledReason,type CreateAvailability,type CreateNoticeLevel } from "../v1/createAvailability.ts";
import {
buildCreateMarketRequest,buildLaunchAndBuyRequests,
deriveCreateMarketParams,
findCanonicalMarketCreated,launchAbis,resolveBurnLaunchConfig,resolveLpLaunchConfig,type SelectedLaunchConfig
} from "../v1/features/launch.ts";

import { resolveLaunchFunding,type LaunchFunding } from "../v1/launchFunding.ts";
import { LAUNCH_CONFIRMED_COPY,notifyLaunchDatabase } from "../v1/pendingMarket.ts";
import {
TickerGardenV1Client
} from "../v1/readApi.ts";
import { rememberDetailMetadata } from "../v1/tokenMetadata.ts";
import {
type ContractWriteRequest,
type TransactionUpdate
} from "../v1/transaction.ts";
import type { ControllerContext,LaunchPreview,WalletState } from '../app.ts';
export function createCreateController(ctx:ControllerContext){
let completionPending=false;
async function presentCompletedLaunch():Promise<void>{
 if(completionPending)return;
 const state=ctx.launchProgress;if(!state?.expected)return;
 completionPending=true;
 try{
  renderLaunchProgress({title:'Launching Your Token',step:'Confirm on chain',percent:95,detail:'Your transaction is confirmed.'},{});
  const ready=await finishLaunchProgress(async signal=>{
   if(!ctx.runtimeConfig.readApi.available)throw new Error('Market data service is not configured');
   await waitForLaunchData(ctx.runtimeConfig.readApi.value,state.expected!.marketId as Hex,state.expected!.token,signal);
  });
  if(ready&&ctx.launchProgress?.id===state.id){
   showLatestListing();closeLaunchProgress();
   try{recoveryRemove(localStorage,launchStateKey(state.chainId));}catch{/* The persisted complete state remains safe to recover. */}
   ctx.launchProgress=null;
  }
 }catch{
  // Chain success is permanent UI state; data service failures are not transaction failures.
  if(ctx.launchProgress?.id===state.id){
   renderLaunchProgress({title:'Launching Your Token',step:'Launch complete',percent:100,detail:'Your token is created. Preparing its data; we will retry automatically.'},{});
   ctx.launchRecoveryTimer=setTimeout(()=>{if(ctx.query('[data-create-form]')&&ctx.launchProgress?.id===state.id)void presentCompletedLaunch();},10000);
  }
 }finally{completionPending=false;}
}
let previewState: "idle"|"loading"|"ready"|"error"="idle";
function drawLaunchProgress():void{
 if(!ctx.launchProgress)return;
 if(ctx.launchProgress.phase==='complete'){void presentCompletedLaunch();return;}
 const display=ctx.launchProgress.phase==='paused'&&!ctx.launchProgress.hash?{step:'Confirm in wallet',percent:60}:launchPhaseDisplay[ctx.launchProgress.phase==='failed'?(ctx.launchProgress.failedFrom??'failed'):ctx.launchProgress.phase];
 renderLaunchProgress({title:ctx.launchProgress.phase==='failed'?'Launch Stopped':'Launching Your Token',...display,detail:['failed','paused'].includes(ctx.launchProgress.phase)&&ctx.launchProgress.diagnostic?launchFailureMessage(ctx.launchProgress.diagnostic.code,ctx.launchProgress.diagnostic.phase,ctx.launchProgress.diagnostic.transactionMayBePending):ctx.launchProgress.phase==='failed'?publicError(undefined,'transaction'):ctx.launchProgress.detail,supportDetails:['failed','paused'].includes(ctx.launchProgress.phase)&&ctx.launchProgress.diagnostic?JSON.stringify(ctx.launchProgress.diagnostic,null,2):undefined,
  canDismiss:ctx.launchProgress.phase==='failed'},
 {onDismiss:()=>{if(ctx.launchProgress?.phase!=='failed')return;recoveryRemove(localStorage,launchStateKey(robinhoodChain.id));ctx.launchProgress=null;closeLaunchProgress();updateCreateAvailability();}});
}

function updateLaunchProgress(phase:LaunchPhase,detail:string):void{
 if(!ctx.launchProgress)return;ctx.launchProgress={...ctx.launchProgress,failedFrom:phase==='failed'?(ctx.launchProgress.failedFrom??ctx.launchProgress.phase):undefined,phase,detail};
 saveLaunchState(localStorage,ctx.launchProgress);drawLaunchProgress();
}

function handleLaunchTransactionUpdate(update:TransactionUpdate):void{
 if(!ctx.launchProgress)return;
 if(update.hash)ctx.launchProgress.hash=update.hash;
 if(update.replacementReason==='cancelled')ctx.launchProgress.cancelled=true;
 if(update.stage==='awaiting_signature')updateLaunchProgress('wallet','Confirm the launch transaction in your wallet. Do not submit a second launch.');
 else if(['submitted','pending','replaced'].includes(update.stage))updateLaunchProgress('pending','Transaction submitted. Waiting for chain confirmation. You may refresh this page.');
 else if(update.stage==='confirming')updateLaunchProgress('confirming','Transaction mined. Verifying your new token…');
 else if((update.stage==='simulating'||update.stage==='preflight')&&ctx.launchProgress.phase!=='approval')updateLaunchProgress('preparing','Preparing and checking your launch transaction…');
 else if(update.stage==='failed'&&['user_rejected','transaction_reverted','replacement_cancelled','simulation_failed'].includes(update.error?.code??''))updateLaunchProgress('failed',update.error?.message??'The transaction did not complete.');
 else if(update.stage==='unknown')updateLaunchProgress('paused','Confirmation is taking longer. We will check again automatically. Please do not launch again.');
}

async function finishRecoveredLaunch(state:LaunchState,receipt:TransactionReceipt):Promise<void>{
 const expected=state.expected;if(!expected)throw Error('Saved launch identity is missing');
 assertRecoveredLaunchReceipt(state,receipt);
 ctx.directMarkets?.receipt(receipt);
 if(state.listing){ctx.latestListing={snapshot:{...state.listing,txHash:receipt.transactionHash},marketId:expected.marketId};try{localStorage.setItem(`tg-listing:${robinhoodChain.id}`,JSON.stringify(ctx.latestListing));}catch{/* The confirmed listing remains available in memory. */}}
 try{if(state.intent)clearVerifiedLaunchTransaction(localStorage,state.chainId,state.account,state.intent,receipt.transactionHash);}catch{/* Preserve unreadable unrelated records. */}
 clearCreateDraft(localStorage, state.chainId); ctx.pendingCreateDraft = null;
 ctx.launchProgress={...state,phase:'complete',hash:receipt.transactionHash,detail:LAUNCH_CONFIRMED_COPY};
 void notifyLaunchDatabase(receipt.transactionHash,import.meta.env.VITE_V1_PIPELINE_URL).then(()=>ctx.snapshotPoller?.reconnect());
 saveLaunchState(localStorage,ctx.launchProgress);
 await presentCompletedLaunch();
}

async function restoreLaunchProgress():Promise<void>{
 if(ctx.launchSubmitting||ctx.launchRecoveryBusy)return;
 if(ctx.launchRecoveryTimer){clearTimeout(ctx.launchRecoveryTimer);ctx.launchRecoveryTimer=undefined;}
 try{ctx.launchProgress=ctx.launchProgress??readLaunchState(localStorage,robinhoodChain.id);}catch(error){
  renderLaunchProgress({title:'Launch recovery needs attention',step:'Check saved launch',detail:publicError(error,'recovery'),percent:0},{});return;
 }
 const state=ctx.launchProgress;if(!state){closeLaunchProgress();updateCreateAvailability();return;}
 if(state.phase==='complete'&&state.expected){
  drawLaunchProgress();return;
 }
 // Recover the narrow gap between executor persistence and the UI callback.
 if(!state.hash&&state.intent){
  try{const pending=savedLaunchTransaction(localStorage,state.chainId,state.account,state.intent);
   if(pending?.intent===state.intent&&/^0x[\da-f]{64}$/i.test(pending.hash)){state.hash=pending.hash;state.cancelled=pending.cancelled;state.phase='pending';saveLaunchState(localStorage,state);}
  }catch{/* Retain the launch guard when wallet history is uncertain. */}
 }
 if(state.phase==='failed'){drawLaunchProgress();return;}
 const lockSnapshot=await navigator.locks?.query();
 if(lockSnapshot?.held?.some(l=>l.name===`tg-launch:${state.chainId}`)){
  drawLaunchProgress();ctx.launchRecoveryTimer=setTimeout(()=>void restoreLaunchProgress(),10000);return;
 }
 if(!state.hash&&state.expected&&ctx.runtimeConfig.readApi.available){
  ctx.launchRecoveryBusy=true;
  try{const recovered=await new TickerGardenV1Client(ctx.runtimeConfig.readApi.value,(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})).getLaunchRecovery({marketId:state.expected.marketId as Hex});
   if(recovered.chainId===state.chainId&&recovered.displayOnly===true&&recovered.marketId===state.expected.marketId&&/^0x[0-9a-f]{64}$/.test(recovered.transactionHash)){state.hash=recovered.transactionHash;state.phase='pending';saveLaunchState(localStorage,state);}
  }catch{/* Receipt recovery remains available; no launch is resubmitted. */}finally{ctx.launchRecoveryBusy=false;}
 }
 if(!state.hash&&state.diagnostic?.operation==='purchase_asset'&&state.diagnostic.transactionMayBePending){
  if(ctx.wallet?.account.toLowerCase()===state.account.toLowerCase()){
   try{
    await recoverQuotePurchase();
    state.diagnostic={...state.diagnostic,code:'purchase_checked',transactionMayBePending:false};
    updateLaunchProgress('failed','The paired asset purchase has been checked. Return to the form to continue using your updated balance.');return;
   }catch{/* Keep checking the existing purchase, never submit another here. */}
  }
  drawLaunchProgress();ctx.launchRecoveryTimer=setTimeout(()=>void restoreLaunchProgress(),10000);return;
 }
 if(!state.hash){
  // A tab holding the launch lock may still be uploading or waiting on its wallet.
  if(state.phase==='wallet'||state.phase==='paused')updateLaunchProgress('paused','We are checking whether your launch was submitted. Please keep this page open while we confirm the result.');
  else updateLaunchProgress('failed','Preparation was interrupted before the launch was sent. Return to the form to continue. Any asset approval is a separate transaction.');
  if(state.phase==='wallet'||state.phase==='paused')ctx.launchRecoveryTimer=setTimeout(()=>void restoreLaunchProgress(),10000);
  return;
 }
 ctx.launchRecoveryBusy=true;drawLaunchProgress();
 let receiptFound=false;
 try{
  const receipt=await ctx.publicClient.getTransactionReceipt({hash:state.hash as Hash});
  receiptFound=true;
  if(ctx.launchProgress?.hash!==state.hash)return;
  const target=state.intent?JSON.parse(state.intent)[0]:null;
  if(receipt.from.toLowerCase()!==state.account.toLowerCase()||!target||receipt.to?.toLowerCase()!==target)throw Error('Receipt does not match the saved launch sender and destination');
  if(receipt.status==='reverted'||state.cancelled){
   const transaction=await ctx.publicClient.getTransaction({hash:state.hash as Hash});
   if(!state.data||transaction.input.toLowerCase()!==state.data.toLowerCase())throw Error('Reverted transaction calldata does not match this launch');
   try{if(state.intent)clearVerifiedLaunchTransaction(localStorage,state.chainId,state.account,state.intent,receipt.transactionHash);}catch{/* Keep unrelated records. */}
   ctx.launchProgress=failedLaunchState(state,state.cancelled?'replacement_cancelled':'transaction_reverted');saveLaunchState(localStorage,ctx.launchProgress);drawLaunchProgress();return;}
  await finishRecoveredLaunch(state,receipt);
 }catch{
  updateLaunchProgress('paused',receiptFound?'Your transaction was found. We are verifying the launch details and will retry automatically.':'Your launch is still being confirmed. We will check again shortly.');
  ctx.launchRecoveryTimer=setTimeout(()=>void restoreLaunchProgress(),10000);
 }finally{ctx.launchRecoveryBusy=false;}
}

function renderDeveloperBuyBalance(): void {
  const label = ctx.query<HTMLElement>("[data-developer-buy-balance]");
  const notice = ctx.query<HTMLElement>("[data-developer-buy-notice]");
  if (!label || !notice) return;
  notice.hidden = true;
  notice.textContent = "";
  const account = ctx.wallet?.account;
  if (!account) { label.textContent = "Connect wallet for balance"; return; }
  const selection = ctx.query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value ?? "";
  const asset = releasePairForSelection(selection, ctx.foundation?.quotes ?? []);
  if (!asset) { label.textContent = "Balance unavailable"; return; }
  const native = asset.tokenAddress === ZERO_ADDRESS;
  const key = `${robinhoodChain.id}:${account}:${asset.tokenAddress}`;
  const pageGeneration = ctx.routeGeneration;
  label.textContent = `Balance: loading ${asset.symbol}…`;
  void ctx.developerBuyBalances.read(key, () => native
    ? ctx.publicClient.getBalance({ address: account })
    : ctx.publicClient.readContract({ address: asset.tokenAddress as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] })
  ).then(balance => {
    if (ctx.routeGeneration !== pageGeneration || ctx.wallet?.account !== account || ctx.query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value !== selection) return;
    label.textContent = balance === null ? `Balance unavailable · ${asset.symbol}` : `Balance: ${formatTokenAmount(balance, asset.decimals)} ${asset.symbol}`;
    if (balance === null) return;
    try {
      const raw = ctx.query<HTMLInputElement>("[name=firstBuyAmount]")?.value.trim() ?? "";
      const amount = raw ? parseTokenAmount(raw, asset.decimals, "Developer buy") : 0n;
      notice.textContent = developerBuyNotice({ amount, balance, symbol: asset.symbol,
        displayAmount: formatTokenAmount(amount, asset.decimals), native, canPurchase:robinhoodChain.id===4663&&!isQuoteSelectionPaused(asset),
      });
      notice.hidden = !notice.textContent;
    } catch { /* Field validation explains invalid amounts. */ }
  });
}

function launchDetails() {
  const value = (name: string) => ctx.query<HTMLInputElement | HTMLTextAreaElement>(`[data-create-form] [name=${name}]`)?.value.trim() ?? "";
  return { name: value("name"), symbol: value("symbol"), description: value("description"), x: value("x"), website: value("website"), creatorFeesToHolders: ctx.query<HTMLInputElement>("[name=treasuryEnabled]")?.checked ?? false, creatorTaxBps: (() => { try { return creatorTaxBps(value("creatorTax")); } catch { return 0; } })(), image: ctx.launchImage };
}

function currentMetadataURI(): string {
  return ctx.preparedMetadataKey === JSON.stringify(launchDetails()) ? ctx.preparedMetadataURI : "";
}

async function prepareLaunchMetadata(): Promise<void> {
  if(!ctx.launchImage||ctx.launchImageReading)throw new Error("Add a token image.");
  if (currentMetadataURI()) return;
  if (!ctx.launchMetadataOrigin) throw new Error("Publishing unavailable. Try again later.");
  const details = launchDetails();
  const key = JSON.stringify(details);
  setCreateNoticeLevel("[data-create-preview]", "info");
  ctx.text("[data-create-preview]", "Publishing details and image…");
  const activeWallet=ctx.wallet;if(!activeWallet)throw Error('Connect Your Wallet');
  await ctx.verifyLiveWalletContext(activeWallet);
  ctx.text('[data-create-preview]','Confirm Upload In Your Wallet…');
  const authorization=canResumeUpload(ctx.launchMetadataOrigin,details,`${robinhoodChain.id}:${activeWallet.account.toLowerCase()}`)?undefined:await authorizeUpload(ctx.launchMetadataOrigin,JSON.stringify(details),activeWallet.account,robinhoodChain.id,async message=>{
    await ctx.verifyLiveWalletContext(activeWallet);
    const encoded='0x'+[...new TextEncoder().encode(message)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const signature=await activeWallet.provider.request({method:'personal_sign',params:[encoded,activeWallet.account]});
    await ctx.verifyLiveWalletContext(activeWallet);return String(signature);
  });
  if(key!==JSON.stringify(launchDetails()))throw Error('Details Changed. Review And Retry.');
  ctx.text('[data-create-preview]','Publishing Details And Image…');
  const published = await publishLaunchDetails(ctx.launchMetadataOrigin, details,authorization,`${robinhoodChain.id}:${activeWallet.account.toLowerCase()}`);
  if (key !== JSON.stringify(launchDetails())) throw new Error("Details changed. Review and retry.");
  if (!published.metadata) throw new Error("Published details missing. Try again later.");
  if (isIPFSFileURI(published.metadataURI) && !ipfsGatewayURL(published.metadataURI,import.meta.env.VITE_IPFS_GATEWAY)) throw new Error("Image gateway unavailable. Try again later.");
  ctx.preparedMetadataKey = key;
  ctx.preparedMetadataURI = published.metadataURI;
  ctx.preparedMetadata = published.metadata;
  rememberDetailMetadata(published.metadataURI,published.metadata,ctx.launchMetadataOrigin,import.meta.env.VITE_IPFS_GATEWAY);
}

function renderSelectedTokenImage(image?: string, file?: File, dimensions?: { width: number; height: number }): void {
  const previewImage = ctx.required<HTMLImageElement>("[data-token-image]");
  previewImage.hidden = !image;
  if (image) previewImage.src = image; else previewImage.removeAttribute("src");
  ctx.required<HTMLElement>("[data-token-placeholder]").hidden = Boolean(image);
  ctx.required<HTMLElement>("[data-preview-image-frame]").classList.toggle("has-image", Boolean(image));
  const thumbnail = ctx.required<HTMLImageElement>("[data-upload-thumbnail]");
  thumbnail.hidden = !image;
  if (image) thumbnail.src = image; else thumbnail.removeAttribute("src");
  ctx.required<HTMLElement>("[data-upload-icon]").hidden = Boolean(image);
  ctx.required<HTMLElement>("[data-upload-action]").hidden = !image;
  ctx.text("[data-upload-title]", image && file ? file.name : "Choose an image");
  ctx.text("[data-upload-info]", image && file && dimensions
    ? `${file.type.replace("image/", "").toUpperCase()} · ${file.size >= 1048576 ? (file.size / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(file.size / 1024)) + " KB"} · ${dimensions.width} × ${dimensions.height} px`
    : "PNG, JPG or WebP · up to 2 MB");
  ctx.text("[data-image-status]", "");
}

function showLatestListing(): void {
 const host=ctx.query<HTMLElement>("[data-listing-package]");
 if(host&&ctx.latestListing){
  renderListingPanel(host,ctx.latestListing.snapshot,ctx.latestListing.marketId,robinhoodChain.blockExplorers.default.url,robinhoodChain.testnet,import.meta.env.VITE_IPFS_GATEWAY,url=>{ctx.router.navigate(url);});
  const heading=ctx.query<HTMLElement>("[data-create-heading]");if(heading)heading.hidden=true;
  const layout=ctx.query<HTMLElement>(".create-layout");if(layout)layout.hidden=true;
  const again=document.createElement('button');again.type='button';again.textContent='Launch new token';again.className='listing-create-another';host.append(again);
  again.onclick=()=>{ctx.latestListing=null;ctx.launchProgress=null;try{recoveryRemove(localStorage,launchStateKey(robinhoodChain.id));localStorage.removeItem(`tg-listing:${robinhoodChain.id}`);}catch{}host.hidden=true;if(layout)layout.hidden=false;if(heading)heading.hidden=false;};
 }
}

function applyCreateDraft(configReady: boolean): void {
  if (!ctx.pendingCreateDraft) return;
  const form = ctx.query<HTMLFormElement>('[data-create-form]'); if (!form) return;
  const unavailable: string[] = [];
  for (const [key,value] of Object.entries(ctx.pendingCreateDraft)) {
    if (['tickerGardenBaselineId', 'launchTemplateId', 'launchMode'].includes(key)) continue;
    const field = form.elements.namedItem(key);
    if (field instanceof HTMLSelectElement) { if (configReady && typeof value === 'string') {
      if (value && !Array.from(field.options).some(option => option.value === value && !option.disabled)) {
        unavailable.push(key);
      } else field.value = value;
    } }
    else if (field instanceof HTMLInputElement && field.type === 'checkbox' && typeof value === 'boolean') field.checked = value;
    else if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && typeof value === 'string') field.value = value;
  }
  if (configReady) {
    ctx.pendingCreateDraft = null;
    const paired = ctx.query<HTMLSelectElement>('[name=quoteAssetConfigId]'); if (paired) populatePairedAssets();
    const stock = ctx.query<HTMLSelectElement>('[name=assetUid]');
    for (const name of unavailable) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLSelectElement) {
        const option = new Option('Asset unavailable — select another', '');
        field.prepend(option); field.value = '';
        field.setCustomValidity('Asset unavailable. Select another.');
      }
    }
    paired?.dispatchEvent(new Event('change', { bubbles: true }));
    if (stock && ctx.foundation) updateQuotePicker(stock, ctx.foundation.assets.filter(a=>isListedStakingAsset(robinhoodChain.id,a)).map(a=>({value:a.id,symbol:ctx.stockSymbol(a),name:stakingAssetForConfig(robinhoodChain.id,a)?.name??'Stock',logoUrl:ctx.stockLogo(a),pending:false})));
  }
}

function saveCurrentCreateDraft(): void {
  const form = ctx.query<HTMLFormElement>('[data-create-form]'); if (!form || ctx.launchSubmitting) return;
  const values: Record<string,string|boolean> = {};
  for (const field of Array.from(form.elements)) {
    if (field instanceof HTMLInputElement && field.type === 'checkbox') values[field.name] = field.checked;
    else if ((field instanceof HTMLInputElement && field.type !== 'file') || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) values[field.name] = field.value;
  }
  writeCreateDraft(localStorage, robinhoodChain.id, {...values,hadImage:ctx.draftImageMissing || !!ctx.launchImage || !!ctx.query<HTMLInputElement>('[name=tokenImage]')?.files?.length});
}

function setupCreate(): void {
 previewState="idle";
 ctx.query<HTMLButtonElement>("[data-create-preview-retry]")?.addEventListener("click",scheduleLaunchPreview);
 if(!ctx.latestListing){try{ctx.latestListing=parseSavedListing(localStorage.getItem(`tg-listing:${robinhoodChain.id}`),robinhoodChain.id);}catch{/* Browser storage may be disabled. */}}
 if(!readLaunchState(localStorage,robinhoodChain.id))showLatestListing();
  const form = ctx.query<HTMLFormElement>("[data-create-form]");
  if (!form) return;
  ctx.pendingCreateDraft = readCreateDraft(localStorage, robinhoodChain.id);
  ctx.draftImageMissing = ctx.pendingCreateDraft?.hadImage === true;
  applyCreateDraft(false);
  form.addEventListener('invalid', event => {
    if(event.target instanceof HTMLElement)event.target.closest('details')?.setAttribute('open','');
  }, true);
  form.addEventListener('input', saveCurrentCreateDraft);
  form.addEventListener('change', saveCurrentCreateDraft);
  ctx.query<HTMLInputElement>("[name=firstBuyAmount]", form)?.addEventListener("focus", renderDeveloperBuyBalance);
  form.addEventListener("input", (event) => {
    updateLaunchMode();
    const symbol = ctx.query<HTMLInputElement>("[name=symbol]", form);
    if (symbol) symbol.value = symbol.value.toUpperCase();
    renderCreateIdentity();
    if(launchPreviewField((event.target as HTMLInputElement).name))scheduleLaunchPreview();else updateCreateAvailability();
  });
  ctx.query<HTMLInputElement>("[name=tokenImage]", form)?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const generation = ++ctx.launchImageGeneration;
    ctx.launchImageReading = true;
    updateCreateAvailability();
    input.setCustomValidity("");
    input.dispatchEvent(new Event("invalid", { cancelable: true }));
    ctx.launchImage = undefined;
    renderSelectedTokenImage();
    setCreateNoticeLevel("[data-image-status]", "info");
    ctx.text("[data-image-status]", "Reading image…");
    try {
      const file = input.files?.[0];
      const image = await readTokenImage(file);
      let dimensions: { width: number; height: number } | undefined;
      if (image) {
        const decoded = new Image();
        decoded.src = image;
        await decoded.decode();
        dimensions = { width: decoded.naturalWidth, height: decoded.naturalHeight };
      }
      if (generation !== ctx.launchImageGeneration) return;
      ctx.launchImage = image;
      ctx.draftImageMissing = false; saveCurrentCreateDraft();
      renderSelectedTokenImage(image, file, dimensions);
    } catch (error) { if (generation === ctx.launchImageGeneration) { input.setCustomValidity(ctx.errorText(error)); ctx.text("[data-image-status]", ""); input.dispatchEvent(new Event("invalid", { cancelable: true })); } }
    if (generation !== ctx.launchImageGeneration) return;
    ctx.launchImageReading = false;
    scheduleLaunchPreview();
  });
  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if ((target.name === "quoteAssetConfigId" || target.name === "assetUid") && target.value) target.setCustomValidity("");
    if (target.name === "quoteAssetConfigId") alignBaselineToQuote();
    updateLaunchMode();
    renderCreateIdentity();
    if(launchPreviewField(target.name))scheduleLaunchPreview();else updateCreateAvailability();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void ctx.runPageAction(submitLaunch);
  });
  updateLaunchMode();
  renderCreateIdentity();
}

function populatePairedAssets(): void {
  const select = ctx.query<HTMLSelectElement>("[name=quoteAssetConfigId]");
  if (!select) return;
  const previous = releasePairForSelection(select.value, ctx.foundation?.quotes ?? []);
  const priorValue = select.value;
  const pickerOptions: QuotePickerOption[] = [];
  select.replaceChildren();
  for (const asset of sortPairedAssets(RELEASE_PAIRED_ASSETS)) {
    const config = activePairedConfig(asset, ctx.foundation?.quotes ?? [], robinhoodChain.id);
    const option = new Option(`${asset.symbol} — ${asset.name}${config ? "" : asset.graduationThreshold === null ? " · Parameters pending" : " · Pending activation"}`, config?.id ?? `pending:${asset.symbol}`);
    option.disabled = isQuoteSelectionPaused(asset);
    if (option.disabled) option.textContent = `${asset.symbol} — ${asset.name} · Temporarily disabled`;
    select.add(option);
    pickerOptions.push({ value: option.value, symbol: asset.symbol, name: asset.name, pending: !config, disabled: option.disabled });
    if (!option.disabled && (previous?.symbol === asset.symbol || priorValue === option.value)) select.value = option.value;
  }
  updateQuotePicker(select, pickerOptions);
}

function renderCreateConfig(): void {
  const form = ctx.query<HTMLFormElement>("[data-create-form]");
  if (!form) return;
  populatePairedAssets();
  if (ctx.foundation?.direct && ctx.foundation.assets.length===0) {const stock=ctx.query<HTMLInputElement>("[name=stakingEnabled]",form);if(stock){stock.checked=false;stock.disabled=true;}}
  if (!ctx.foundation) {
    const stockSelect = ctx.required<HTMLSelectElement>("[name=assetUid]", form);
    stockSelect.replaceChildren(new Option("Staking assets unavailable", ""));
    updateQuotePicker(stockSelect, []);
    renderCreateIdentity();
    ctx.text("[data-create-config-status]", "Launch unavailable.");
    updateCreateAvailability();
    return;
  }
  const stockSelect = ctx.required<HTMLSelectElement>("[name=assetUid]", form);
  const activeStocks = sortStakingAssets(ctx.foundation.assets.filter((item) => isListedStakingAsset(robinhoodChain.id, item)), ctx.stockSymbol);
  ctx.populateSelect(stockSelect, activeStocks, "No eligible staking assets");
  updateQuotePicker(stockSelect, activeStocks.map((stock) => ({
    value: stock.id,
    symbol: ctx.stockSymbol(stock),
    logoUrl: ctx.stockLogo(stock),
    name: stakingAssetForConfig(robinhoodChain.id,stock)?.name ?? String(stock.values.tokenName ?? "STOCK"),
    pending: false,
  })));
  ctx.populateSelect(ctx.required<HTMLSelectElement>("[name=tickerGardenBaselineId]", form), ctx.foundation.baseline.filter((item) => item.status === 1), "Select an active TickerGarden baseline");
  ctx.populateSelect(ctx.required<HTMLSelectElement>("[name=launchTemplateId]", form), ctx.foundation.templates.filter((item) => item.status === 1), "Select an active launch template");
  applyCreateDraft(true);
  alignBaselineToQuote();
  ctx.text("[data-create-config-status]", ctx.foundation.writeReady
    ? ""
    : "Launch unavailable.");
  updateLaunchMode();
  renderCreateIdentity();
  scheduleLaunchPreview();
}

function alignBaselineToQuote(): void {
  if (!ctx.foundation) return;
  const quoteId = ctx.query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value;
  const baselineSelect = ctx.query<HTMLSelectElement>("[name=tickerGardenBaselineId]");
  const quote = ctx.foundation.quotes.find((item) => item.id === quoteId);
  if (!quote || !baselineSelect) return;
  try {
    const baselineId = configString(quote, "tickerGardenBaselineId").toLowerCase();
    if ([...baselineSelect.options].some((option) => option.value === baselineId)) baselineSelect.value = baselineId;
  } catch { /* The launch validator reports the missing field. */ }
}

function updateLaunchMode(): void {
  const amount = ctx.query<HTMLInputElement>("[name=firstBuyAmount]");
  let mode: "create" | "create-buy" = "create";
  try { mode = developerBuyMode(amount?.value ?? ""); amount?.setCustomValidity(""); }
  catch (error) { amount?.setCustomValidity(ctx.errorText(error)); }
  const select = ctx.query<HTMLSelectElement>("[name=launchMode]");
  if (select) select.value = mode;
  const lpEnabled=ctx.query<HTMLInputElement>("[name=lpFeeEnabled]")?.checked ?? false;
  const lpSelect=ctx.query<HTMLSelectElement>("[name=lpFeePips]");
  if(lpSelect)lpSelect.disabled=!lpEnabled;
  const lpOptions=ctx.query<HTMLElement>("#lp-fee-options");if(lpOptions)lpOptions.hidden=!lpEnabled;
  ctx.text("[data-preview-lp-fee]", `${lpEnabled ? Number(lpSelect?.value ?? 1000)/10000 : 0}%`);
  ctx.text("[data-preview-meme-burn]", ctx.query<HTMLInputElement>("[name=burnMemeFees]")?.checked ? "On · permanent" : "Off");
  const tax = ctx.query<HTMLInputElement>("[name=creatorTax]");
  if (tax) {
    try { const bps = creatorTaxBps(tax.value); assertCreatorTaxSupported(bps); tax.setCustomValidity(""); }
    catch(error) { tax.setCustomValidity(ctx.errorText(error)); }
  }
}

function renderCreateIdentity(): void {
  renderDeveloperBuyBalance();
  const details = launchDetails();
  const burn=ctx.query<HTMLInputElement>("[name=burnMemeFees]")?.checked??false;
  const burnToken = details.symbol.trim() || details.name.trim() || "your token";
  ctx.text("[data-burn-token-label]", `Burn ${burnToken}`);
  ctx.text("[data-preview-burn-label]", `Burn ${burnToken}`);
  ctx.text("#meme-fee-burn-help", `Burn fees earned in ${burnToken}. Paired-asset rewards and platform fees are unaffected. Permanent at launch.`);
  ctx.text("[data-fee-burn-note]", `Fees earned in ${burnToken} are burned at settlement; paired-asset rewards are paid out. Platform fees are unaffected.`);
  ctx.text("[data-creator-tax-help]",burn?`Extra trading fee (0–5%). The paired asset is paid to you; ${burnToken} is burned when you claim. Fixed at launch.`:"Extra trading fee (0–5%), allocated to you. Fixed at launch.");
  const burnNote=ctx.query<HTMLElement>("[data-fee-burn-note]");if(burnNote)burnNote.hidden=!burn;
  ctx.text("[data-creator-tax-recipient]",burn?`Paired asset to you · ${burnToken} burned`:"100% to you");
  ctx.text("[data-preview-creator-tax]", `${formatTokenAmount(BigInt(details.creatorTaxBps), 2)}%`);
  ctx.text("[data-preview-treasury]", details.creatorFeesToHolders ? "50% of creator base fees" : "Off");
  ctx.text("[data-treasury-option-status]", burn?`Allocate 50% of your creator base-fee share to holders. ${burnToken} portions are burned; paired-asset rewards are paid normally. Fixed at launch.`:"Share 50% of your creator base-fee share with holders. Creator tax stays yours. Fixed at launch.");
  ctx.text("[data-token-name]", details.name || "Your next big idea");
  ctx.text("[data-token-symbol]", details.symbol || "ticker");
  ctx.text("[data-token-description]", details.description);
  const description=ctx.query<HTMLTextAreaElement>('[data-create-form] [name=description]');
  if(description){
    const error=fieldError(description.value,{kind:'description'});
    description.setCustomValidity(error);
    if(error)description.setAttribute('aria-invalid','true');
    ctx.text('[data-description-count]',`${description.value.length} / 300`);
  }
  const stakingEnabled = ctx.query<HTMLInputElement>("[name=stakingEnabled]")?.checked ?? false;
  const stockSelect = ctx.query<HTMLSelectElement>("[name=assetUid]");
  if (stockSelect) { stockSelect.required = stakingEnabled; stockSelect.disabled = !stakingEnabled; }
  const stockField = ctx.query<HTMLElement>("[data-staking-stock-field]");
  if (stockField) stockField.hidden = !stakingEnabled;
  const feeTable = ctx.query<HTMLElement>("[data-fee-current-table]");
  const feeSettings = `${details.creatorFeesToHolders}:${stakingEnabled}`;
  if (feeTable && feeTable.dataset.settings !== feeSettings) {
    feeTable.innerHTML = feePreviewTable(details.creatorFeesToHolders, stakingEnabled);
    feeTable.dataset.settings = feeSettings;
  }
  try {
    const tax = creatorTaxBps(ctx.query<HTMLInputElement>("[name=creatorTax]")?.value ?? "0");
    assertCreatorTaxSupported(tax);
    ctx.text("[data-fee-tax]", `${formatTokenAmount(BigInt(tax), 2)}%`);
    const recipient=ctx.query<HTMLElement>("[data-creator-tax-recipient]");if(recipient)recipient.hidden=tax===0;
  } catch { ctx.text("[data-fee-tax]", "Invalid rate");const recipient=ctx.query<HTMLElement>("[data-creator-tax-recipient]");if(recipient)recipient.hidden=true; }
  ctx.text("[data-fee-staking-note]", stakingEnabled
    ? "Staker fees apply after Bloomed, with active stake."
    : "Staking is off. Fee split stays unchanged.");
  ctx.text("[data-preview-asset]", !stakingEnabled ? "Staking disabled" : stockSelect?.value ? stockSelect.selectedOptions[0]?.textContent?.split(" · ")[0] ?? "-" : "-");
  const selection = ctx.query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value ?? "";
  const quote = ctx.foundation?.quotes.find(item => item.id === selection);
  const releaseAsset = releasePairForSelection(selection, ctx.foundation?.quotes ?? []);
  ctx.displayPriceWidget?.setToken(typeof quote?.values.quoteAsset === "string" ? quote.values.quoteAsset : null);
  ctx.text('[data-preview-launch-fee]',FIXED_LAUNCH_FEE_LABEL);
  ctx.text("[data-preview-trade-fee]", "-");
  ctx.text("[data-preview-graduation]", "-");
  ctx.text("[data-graduation-caption]", "Loading bloom target…");
  ctx.text("[data-graduation-exact]", "");
  const symbol = releaseAsset?.symbol ?? "-";
  ctx.text("[data-preview-quote]", symbol);
  ctx.text("[data-buy-symbol]", symbol);
  const amount = ctx.query<HTMLInputElement>("[name=firstBuyAmount]")?.value.trim() ?? "";
  ctx.text("[data-preview-mode]", ctx.query<HTMLSelectElement>("[name=launchMode]")?.value === "create-buy" ? `${amount} ${symbol}` : "-");
  if (!quote) {
    if (releaseAsset?.graduationThreshold === null || releaseAsset?.phantomQuote === null) {
      ctx.text("[data-graduation-caption]", "Bloom target pending confirmation");
      ctx.text("[data-preview-graduation]", "Pending");
    } else if (releaseAsset) {
      const amount = graduationAmount(BigInt(releaseAsset.graduationThreshold), releaseAsset.decimals);
      const economics = graduationEconomics(RELEASE_SUPPLY, BigInt(releaseAsset.phantomQuote), BigInt(releaseAsset.graduationThreshold));
      ctx.text("[data-graduation-caption]", `Bloom target: ${amount.display} ${symbol}`);
      ctx.text("[data-preview-graduation]", `${amount.display} ${symbol}`);
      ctx.text("[data-graduation-exact]", `Release target · Pending activation on this network. Exact curve minimum: ${graduationAmount(economics.requiredNet, releaseAsset.decimals).exact} ${symbol}.`);
    }
    return;
  }
  try {
    const baseline = ctx.foundation?.baseline.find(item => item.id === configString(quote, "tickerGardenBaselineId"));
    if (!baseline) throw new Error("Launch economics are unavailable");
    const decimals = configNumber(quote, "quoteDecimals");
    const threshold = configBigInt(quote, "graduationThreshold");
    const result = graduationEconomics(configBigInt(baseline, "supply"), configBigInt(quote, "phantomQuote"), threshold);
    const formatted = graduationAmount(threshold, decimals);
    ctx.text("[data-graduation-caption]", `Bloom target: ${formatted.display} ${symbol}`);
    ctx.text("[data-preview-graduation]", `${formatted.display} ${symbol}`);
    ctx.text("[data-graduation-exact]", `Exact minimum after curve rounding: ${graduationAmount(result.requiredNet, decimals).exact} ${symbol}.`);
    const feeBps = configBigInt(baseline, "curveFeeBps");
    ctx.text("[data-preview-trade-fee]", `${formatTokenAmount(feeBps, 2)}% base`);
    ctx.text("[data-creator-fee-note]", `Base trading fee: ${formatTokenAmount(feeBps, 2)}%. Extra fees may apply to buys in the first 5 seconds; your developer buy is exempt.`);
  } catch { ctx.text("[data-graduation-caption]", "Bloom target unavailable."); }
}

function selectedLaunchConfig(allowPendingMetadata = false): SelectedLaunchConfig {
  if (!ctx.foundation || !ctx.wallet) throw new Error("Connect a wallet and load the V1 registries");
  const form = ctx.required<HTMLFormElement>("[data-create-form]");
  const stakingEnabled = ctx.required<HTMLInputElement>("[name=stakingEnabled]", form).checked;
  const assetUid = ctx.required<HTMLSelectElement>("[name=assetUid]", form).value;
  const quoteId = ctx.required<HTMLSelectElement>("[name=quoteAssetConfigId]", form).value;
  const baselineId = ctx.required<HTMLSelectElement>("[name=tickerGardenBaselineId]", form).value;
  const templateId = ctx.required<HTMLSelectElement>("[name=launchTemplateId]", form).value;
  const asset = ctx.foundation.assets.find((item) => item.id === assetUid && isListedStakingAsset(robinhoodChain.id,item));
  const quote = ctx.foundation.quotes.find((item) => item.id === quoteId);
  const baseline = ctx.foundation.baseline.find((item) => item.id === baselineId);
  const template = ctx.foundation.templates.find((item) => item.id === templateId);
  if ((stakingEnabled && !asset) || !quote || !baseline || !template) throw new Error("Selected launch settings are not active yet");
  const releasedPair = releasePairForSelection(quoteId, ctx.foundation.quotes);
  if (!releasedPair || activePairedConfig(releasedPair, [quote], robinhoodChain.id)?.id !== quoteId) throw new Error("Paired asset does not match the release whitelist on this network");
  if (isQuoteSelectionPaused(releasedPair)) throw new Error("Choose another paired asset to continue.");
  const beneficiary = canonicalAddress(ctx.required<HTMLInputElement>("[name=beneficiary]", form).value.trim() || ctx.wallet.account, "Creator beneficiary");
  const name = ctx.required<HTMLInputElement>("[name=name]", form).value.trim();
  const symbol = ctx.required<HTMLInputElement>("[name=symbol]", form).value.trim();
  assertCreatorTaxSupported(creatorTaxBps(ctx.required<HTMLInputElement>("[name=creatorTax]", form).value));
  const metadataURI = currentMetadataURI() || (allowPendingMetadata ? "ipfs://pending-launch-preview" : "");
  if (!name || name.length > 64) throw new Error("Token name must contain 1–64 characters");
  if (!/^[A-Z0-9]{1,16}$/.test(symbol)) throw new Error("Symbol must contain 1–16 uppercase letters or digits");
  if (!metadataURI) throw new Error("Token details will be saved when you launch");
  return Object.freeze({
    stakingEnabled,
    asset: stakingEnabled && asset ? { assetUid: asset.id, status: asset.status } : undefined,
    quote: {
      configId: quote.id,
      economicsHash: canonicalBytes32(configString(quote, "economicsHash"), "Quote economicsHash"),
      quoteAsset: canonicalAddress(configString(quote, "quoteAsset"), "Quote asset", true),
      tickerGardenBaselineId: canonicalBytes32(configString(quote, "tickerGardenBaselineId"), "Quote TickerGarden baseline"),
      status: quote.status,
    },
    baseline: { baselineId: baseline.id, status: baseline.status },
    template: { templateId: template.id, status: template.status },
    creatorRevenueBeneficiary: beneficiary,
    name,
    symbol,
    metadataURI,
    salt: ctx.launchSalt,
    burnMemeFees: ctx.query<HTMLInputElement>("[name=burnMemeFees]", form)?.checked ?? false,
    lpFeePips: ctx.query<HTMLInputElement>("[name=lpFeeEnabled]", form)?.checked ? Number(ctx.query<HTMLSelectElement>("[name=lpFeePips]", form)?.value) : 0,
    creatorTaxBps: creatorTaxBps(ctx.required<HTMLInputElement>("[name=creatorTax]", form).value),
    creatorFeesToHolders: ctx.query<HTMLInputElement>("[name=treasuryEnabled]", form)?.checked ?? false,
  });
}

async function previewLaunch(walletContext?: WalletState, allowPendingMetadata = false): Promise<LaunchPreview> {
  const activeWallet = walletContext ?? ctx.wallet;
  if (!ctx.foundation?.writeReady || !ctx.runtimeConfig.contracts.available || !activeWallet || ctx.wallet !== activeWallet) throw new Error(ctx.runtimeReasons().join("; ") || "Connect a wallet first");
  await ctx.verifyLiveWalletContext(activeWallet);
  const launchFactoryAddress=ctx.runtimeConfig.contracts.value.factoryAddress;
  const burnSelected = await resolveBurnLaunchConfig(selectedLaunchConfig(allowPendingMetadata), () => ctx.publicClient.readContract({
    abi: currentV4Abis_TickerGardenFactoryV1, address: launchFactoryAddress, functionName: "memeFeeBurnMode",
  }));
  const selected = await resolveLpLaunchConfig(burnSelected, () => ctx.publicClient.readContract({abi:currentV4Abis_TickerGardenFactoryV1,address:launchFactoryAddress,functionName:"lpFeeMode"}));
  await ctx.ensureCurrentRevision(ctx.foundation.sync.revision);
  await ctx.ensureCanonicalLaunch(selected);
  const draft = deriveCreateMarketParams(selected);
  const expectedEconomics = await ctx.publicClient.readContract({
    abi: launchAbis(selected).TickerGardenFactoryV1,
    address: ctx.runtimeConfig.contracts.value.factoryAddress,
    functionName: "previewMarketEconomics",
    args: [draft],
    account: activeWallet.account,
  });
  const params = Object.freeze({ ...draft, expectedEconomics: canonicalBytes32(expectedEconomics, "Expected economics") });
  const predicted = await ctx.publicClient.readContract({
    abi: launchAbis(selected).TickerGardenFactoryV1,
    address: ctx.runtimeConfig.contracts.value.factoryAddress,
    functionName: "predictMarketAddresses",
    args: [activeWallet.account, params],
    account: activeWallet.account,
  });
  await ctx.verifyLiveWalletContext(activeWallet);
  return Object.freeze({
    creator: activeWallet.account,
    selected,
    params,
    marketId: canonicalBytes32(predicted[0], "Predicted marketId"),
    memeToken: canonicalAddress(predicted[1], "Predicted token"),
    curve: canonicalAddress(predicted[2], "Predicted Curve"),
    gauge: canonicalAddress(predicted[3], "Predicted Gauge", !params.stakingEnabled),
    launchLocker: canonicalAddress(predicted[4], "Predicted LaunchLocker"),
  });
}

function scheduleLaunchPreview(): void {
  window.clearTimeout(ctx.launchPreviewTimer);
  const generation = ++ctx.launchPreviewGeneration;
  ctx.launchPreview = null;
  ctx.launchFunding = null;
  previewState="loading";
  const retry=ctx.query<HTMLButtonElement>("[data-create-preview-retry]");if(retry)retry.hidden=true;
  ctx.text("[data-create-preview]", "");
  updateCreateAvailability();
  ctx.launchPreviewTimer = window.setTimeout(() => { void refreshLaunchPreview(generation); }, 350);
}

async function refreshLaunchPreview(generation: number): Promise<void> {
  const form=ctx.query<HTMLFormElement>('[data-create-form]');
  // An unfinished form is normal. Do not run RPC previews or report it as a failure.
  if(!form||!ctx.wallet||!ctx.foundation?.writeReady||[...form.elements].some(field=>
    (field instanceof HTMLInputElement||field instanceof HTMLSelectElement||field instanceof HTMLTextAreaElement)&&!field.disabled&&!field.validity.valid)){
    if(generation===ctx.launchPreviewGeneration){previewState='idle';updateCreateAvailability();ctx.text('[data-create-preview]','');const funding=ctx.query<HTMLElement>('[data-launch-funding]');if(funding)funding.hidden=true;}
    return;
  }
  try {
    const preview = await previewLaunch(undefined, true);
    const funding = await calculateLaunchFunding(preview);
    if (generation !== ctx.launchPreviewGeneration) return;
    previewState="ready";
    ctx.launchPreview = preview;
    ctx.launchFunding = funding;
    renderLaunchFunding(funding);
    ctx.text("[data-create-preview]", "");
    setCreateNoticeLevel("[data-create-preview]", "info");
    renderCreateIdentity();
    updateCreateAvailability();
  } catch (error) {
    if (generation !== ctx.launchPreviewGeneration) return;
    ctx.launchPreview = null;
    ctx.launchFunding = null;
    const panel = ctx.query<HTMLElement>("[data-launch-funding]");
    if (panel) panel.hidden = true;
    previewState="error";
    const retry=ctx.query<HTMLButtonElement>("[data-create-preview-retry]");if(retry)retry.hidden=false;
    ctx.text("[data-create-preview]", launchFailureMessage(launchErrorCode(error),'preparing',false));
    setCreateNoticeLevel("[data-create-preview]", "error");
    updateCreateAvailability();
  }
}

function setCreateNoticeLevel(selector:string,level:CreateNoticeLevel):void {
  const notice=ctx.query<HTMLElement>(selector);if(!notice)return;
  notice.classList.add('create-notice');
  notice.classList.toggle('create-notice-warning',level==='warning');
  notice.classList.toggle('create-notice-error',level==='error');
  notice.dataset.noticeLevel=level;
}

function updateCreateAvailability(): void {
  const button = ctx.query<HTMLButtonElement>("[data-create-submit]");
  const form = ctx.query<HTMLFormElement>("[data-create-form]");
  if (!button || !form) return;
  const buyMode = ctx.query<HTMLSelectElement>("[name=launchMode]")?.value === "create-buy";
  const invalid = [...form.elements].find((e): e is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement) && !e.disabled && !e.validity.valid);
  const labels: Record<string,string> = {name:"Name",symbol:"Ticker",description:"Description",assetUid:"Staking asset",quoteAssetConfigId:"Paired asset",website:"Website",x:"X profile",firstBuyAmount:"Developer buy",creatorTax:"Creator tax",beneficiary:"Creator beneficiary",tickerGardenBaselineId:"Market pricing",launchTemplateId:"Launch settings",tokenImage:"Token image"};
  const availability:CreateAvailability={submitting:ctx.launchSubmitting||Boolean(ctx.launchProgress&&ctx.launchProgress.phase!=="complete"),imageReading:ctx.launchImageReading,imageReady:Boolean(ctx.launchImage),
    runtimeReady:Boolean(ctx.foundation?.writeReady),runtimeReason:ctx.runtimeReasons().join("; "),walletConnected:Boolean(ctx.wallet),busy:Boolean(ctx.launchSubmitting||ctx.walletConnecting),
    pendingQuote:ctx.query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value.startsWith("pending:")===true,
    invalidField:invalid ? labels[invalid.name] ?? invalid.name : undefined,metadataReady:Boolean(ctx.launchMetadataOrigin),buyMode,
    previewState,fundingReady:Boolean(ctx.launchFunding),insufficientEth:Boolean(ctx.launchFunding&&ctx.launchFunding.ethBalance<ctx.launchFunding.totalRequired)};
  const reason=ctx.draftImageMissing ? "Reselect your image." : createDisabledReason(availability);
  ctx.setDisabled(button, Boolean(reason));
  let hint = ctx.query<HTMLElement>("[data-create-blocker]",form);
  if(!hint){hint=document.createElement("p");hint.dataset.createBlocker="";hint.id="create-blocker";hint.setAttribute("role","status");button.insertAdjacentElement("beforebegin",hint);}
  const fieldError=reason?.startsWith('Check ')===true;
  const showReason=!!reason&&(!fieldError||invalid?.getAttribute('aria-invalid')==='true');
  setCreateNoticeLevel('[data-create-blocker]',ctx.draftImageMissing ? 'error' : createDisabledLevel(availability));
  hint.textContent=showReason ? reason! : '';hint.hidden=!showReason;
  if(showReason)button.setAttribute("aria-describedby",hint.id);else button.removeAttribute("aria-describedby");
}

async function calculateLaunchFunding(preview: LaunchPreview): Promise<LaunchFunding & Readonly<{ gasCost: bigint; totalRequired: bigint; quoteDecimals: number }>> {
  if (!ctx.foundation?.bindings || ctx.foundation.launchFee === undefined) throw new Error("Launch funding bindings are unavailable");
  const decimals = await quoteDecimalsFor(preview.selected);
  const amountText = ctx.query<HTMLInputElement>("[name=firstBuyAmount]")?.value.trim() ?? "";
  const quoteAmount = developerBuyMode(amountText) === "create-buy" ? parseTokenAmount(amountText, decimals, "First buy amount") : 0n;
  const funding = await resolveLaunchFunding({
    client: ctx.publicClient as never,
    account: preview.creator,
    quoteAsset: preview.selected.quote.quoteAsset,
    quoteAmount,
    ...(robinhoodChain.id===4663 && ctx.runtimeConfig.readApi.available ? {quotePurchase:(shortfall:bigint)=>fetchPurchaseQuote(ctx.runtimeConfig.readApi.available?ctx.runtimeConfig.readApi.value:'',robinhoodChain.id,preview.selected.quote.quoteAsset,shortfall,preview.creator)} : {}),
  });
  const fees = await ctx.publicClient.estimateFeesPerGas();
  const feePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (feePerGas === undefined) throw new Error("Network gas price is unavailable");
  const gasCost = (ctx.CONSERVATIVE_LAUNCH_GAS + (funding.purchase ? 1500000n : 0n)) * feePerGas;
  const transactionValue = ctx.foundation.launchFee + (funding.purchase?purchaseEthLimit(BigInt(funding.purchase.amountIn)):funding.quotedNativeInput);
  return Object.freeze({ ...funding, gasCost, totalRequired: transactionValue + gasCost, quoteDecimals: decimals });
}

function renderLaunchFunding(funding: LaunchFunding & Readonly<{ gasCost: bigint; totalRequired: bigint; quoteDecimals: number }>): void {
  const panel = ctx.query<HTMLElement>("[data-launch-funding]");
  if (panel) panel.hidden = false;
  const symbol = releasePairForSelection(ctx.query<HTMLSelectElement>("[name=quoteAssetConfigId]")?.value ?? "", ctx.foundation?.quotes ?? [])?.symbol ?? "Quote";
  const conversion=Boolean(funding.purchase);
  for(const selector of ['[data-funding-route]','[data-funding-swap]']){
    const row=ctx.query<HTMLElement>(selector)?.parentElement;if(row)row.hidden=!conversion;
  }
  ctx.text("[data-funding-route]", conversion ? `ETH → ${symbol}` : funding.mode === "quote" ? `Wallet ${symbol}` : "ETH");
  ctx.text("[data-funding-quote-balance]", funding.mode === "native" ? "ETH" : `${funding.quoteBalance === null ? "—" : formatTokenAmount(funding.quoteBalance, funding.quoteDecimals)} ${symbol}`);
  ctx.text("[data-funding-swap]", `${formatTokenAmount(funding.quotedNativeInput, 18)} ETH`);
  ctx.text("[data-funding-gas]", `${formatTokenAmount(funding.gasCost, 18)} ETH`);
  ctx.text("[data-funding-total]", `${formatTokenAmount(funding.totalRequired, 18)} ETH`);
  ctx.text("[data-funding-balance]", `${formatTokenAmount(funding.ethBalance, 18)} ETH`);
}

async function quoteDecimalsFor(selected: SelectedLaunchConfig): Promise<number> {
  if (selected.quote.quoteAsset === ZERO_ADDRESS) return 18;
  const result = await ctx.publicClient.readContract({ abi: erc20Abi, address: selected.quote.quoteAsset, functionName: "decimals" });
  if (result < 6 || result > 18) throw new Error("Quote decimals are outside the approved 6–18 range");
  return result;
}


const purchaseStateKey=(account:string)=>`tg-quote-purchase:${robinhoodChain.id}:${account.toLowerCase()}`;
async function recoverQuotePurchase():Promise<void>{
 const active=ctx.wallet;if(!active)return;
 const key=purchaseStateKey(active.account),raw=recoveryRead(localStorage,key);if(!raw)return;
 const saved=JSON.parse(raw) as {hash?:Hash};
 const pending=active.executor.pending(active.account).find(item=>item.operationKey.startsWith('quote-purchase:'));
 if(pending)saved.hash=pending.hash;
 if(!saved.hash)throw Error('The paired asset purchase outcome is not yet available. Keep this page open; do not submit another purchase.');
 const receipt=await ctx.publicClient.getTransactionReceipt({hash:saved.hash}).catch(()=>null);
 if(!receipt)throw Error('Your paired asset purchase is still pending. Wait for confirmation before trying again.');
 if(pending)await active.executor.reconcilePending(active.account,pending.operationKey);
 recoveryRemove(localStorage,key);
 // Never resend a recovered purchase. A fresh balance read determines the remaining shortfall.
}
async function executeQuotePurchase(q:PurchaseQuote,wallet:WalletState,preview:LaunchPreview,maximumEth:bigint):Promise<void>{
 const request={...purchaseRequest(q,wallet.account,Date.now(),maximumEth),gas:1500000n};
 const code=await ctx.publicClient.getCode({address:request.address});
 if(!code||keccak256(code)!=='0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde')throw Error('The purchase route is not ready. Try again later.');
 await recoverQuotePurchase();
 const key=purchaseStateKey(wallet.account);
 const purchaseIntent={data:encodeFunctionData(request),value:String(request.value)};
 updateLaunchProgress('preparing','Buying the paired asset with ETH. Confirm the purchase in your wallet.');
 await ctx.executeTransaction({operationKey:`quote-purchase:${preview.marketId}`,scope:{businessType:'other',conflictKey:`launch:${preview.marketId}`},sync:ctx.foundation!.sync,walletContext:wallet,request,quoteExpiresAtMs:q.expiresAt,
 verifyChain:async()=>{await ctx.ensureCanonicalLaunch(preview.selected);purchaseRequest(q,wallet.account,Date.now(),maximumEth);},
 onUpdate:update=>{
  if(update.stage==='awaiting_signature')localStorage.setItem(key,JSON.stringify({...purchaseIntent,stage:'wallet'}));
  if(update.hash)recoveryWrite(localStorage,key,JSON.stringify({...purchaseIntent,stage:update.stage,hash:update.hash}));
  if(update.stage==='failed'&&['user_rejected','transaction_reverted','replacement_cancelled','simulation_failed'].includes(update.error?.code??''))recoveryRemove(localStorage,key);
 },
 confirm:async receipt=>{
  const received=parseEventLogs({abi:erc20Abi,eventName:'Transfer',logs:receipt.logs,strict:true}).filter(log=>log.address.toLowerCase()===q.token.toLowerCase()&&log.args.to.toLowerCase()===wallet.account.toLowerCase()).reduce((sum,log)=>sum+log.args.value,0n);
  if(received<BigInt(q.amountOut))throw Error('The paired asset purchase is awaiting verification. Keep this page open while its result is checked.');
  recoveryRemove(localStorage,key);
  ctx.developerBuyBalances.invalidate(`${robinhoodChain.id}:${wallet.account}:${q.token}`);
 }});
 updateLaunchProgress('preparing','Paired asset received. Preparing your token launch.');
 const balance=await ctx.publicClient.readContract({abi:erc20Abi,address:q.token,functionName:'balanceOf',args:[wallet.account]});
 const needed=parseTokenAmount(ctx.required<HTMLInputElement>('[name=firstBuyAmount]').value,await quoteDecimalsFor(preview.selected),'Developer buy');
 if(balance<needed)throw Error('Paired asset balance changed. Review your balance and try again.');
}

async function submitLaunch(): Promise<void> {
 await recoverQuotePurchase();
 if(!navigator.locks)throw Error("This browser cannot protect against duplicate launches. Use an up-to-date browser.");
 await navigator.locks.request(`tg-launch:${robinhoodChain.id}`,{ifAvailable:true},async lock=>{
  if(!lock){void restoreLaunchProgress();return;}
  if(readLaunchState(localStorage,robinhoodChain.id)){void restoreLaunchProgress();return;}
  const form=ctx.required<HTMLFormElement>('[data-create-form]');
  if(!form.reportValidity())return;
  if(!ctx.launchImage||ctx.launchImageReading||!ctx.wallet){updateCreateAvailability();return;}
  const reviewedPurchase=ctx.launchFunding?.purchase;
  const snapshot=()=>JSON.stringify({chainId:robinhoodChain.id,account:ctx.wallet?.account,details:launchDetails(),fields:[...new FormData(form).entries()].filter(([,value])=>typeof value==='string')});
  const details=launchDetails();
  const pair=ctx.query<HTMLElement>('[data-preview-quote]')?.textContent ?? '-';
  const buy=ctx.query<HTMLElement>('[data-preview-mode]')?.textContent ?? '-';
  const staking=ctx.query<HTMLInputElement>('[name=stakingEnabled]')?.checked;
  const stock=ctx.query<HTMLElement>('[data-preview-asset]')?.textContent ?? '-';
  const selectedStock=ctx.foundation?.assets.find(asset=>asset.id===ctx.query<HTMLSelectElement>('[name=assetUid]')?.value);
  const content=document.createElement('section');content.className='launch-confirm-content';
  const identity=document.createElement('div');identity.className='launch-confirm-identity';
  const image=document.createElement('img');image.src=ctx.launchImage;image.alt='';
  const identityText=document.createElement('div');
  const name=document.createElement('strong');name.textContent=details.name;
  const ticker=document.createElement('span');ticker.textContent=`$${details.symbol}`;
  identityText.append(name,ticker);identity.append(image,identityText);content.append(identity);
  const addRows=(rows:readonly (readonly [string,string,string?])[],className='')=>{
    const list=document.createElement('dl');list.className=`launch-confirm-rows ${className}`;
    for(const [label,value,iconUrl] of rows){const row=document.createElement('div');const term=document.createElement('dt');term.textContent=label;const definition=document.createElement('dd');if(iconUrl)definition.append(createConfirmationAsset(value,iconUrl,label==='Paired Asset'));else definition.textContent=value;if(label==='Wallet'){definition.title=value;definition.textContent=shortHex(value,7,5);}row.append(term,definition);list.append(row);}
    content.append(list);
  };
  addRows([['Network',robinhoodChain.name],['Wallet',ctx.wallet.account]]);
  addRows([['Paired Asset',pair,quoteIconUrl(pair)],['Developer Buy',buy],['Staking Stock',staking ? stock : 'Disabled',staking ? (selectedStock ? ctx.stockLogo(selectedStock) : quoteIconUrl(stock)) : undefined],[`Burn ${details.symbol.trim() || details.name.trim() || 'your token'}`,ctx.query<HTMLInputElement>('[name=burnMemeFees]')?.checked ? 'On' : 'Off'],['LP Fee',`${ctx.query<HTMLInputElement>('[name=lpFeeEnabled]')?.checked ? Number(ctx.query<HTMLSelectElement>('[name=lpFeePips]')?.value)/10000 : 0}%`],['Creator Tax',`${details.creatorTaxBps/100}%`],['Holder Fee Sharing',details.creatorFeesToHolders ? 'Enabled' : 'Disabled']]);
  if(reviewedPurchase)addRows([['Buy paired asset',`${formatUnits(BigInt(reviewedPurchase.amountOut),ctx.launchFunding!.quoteDecimals)} ${pair}`],['Estimated ETH',`${formatUnits(BigInt(reviewedPurchase.amountIn),18)} ETH`],['Maximum ETH (+10%)',`${formatUnits(purchaseEthLimit(BigInt(reviewedPurchase.amountIn)),18)} ETH`],['Price impact (including fees)',`${(reviewedPurchase.priceImpactBps/100).toFixed(2)}%`],['Minimum received',`${formatUnits(BigInt(reviewedPurchase.amountOut),ctx.launchFunding!.quoteDecimals)} ${pair}`]]);
  if(reviewedPurchase)content.append(createPurchaseNotice());
  if(ctx.launchFunding)addRows([[reviewedPurchase?'Required ETH (incl. gas)':'Estimated Total',`${formatTokenAmount(ctx.launchFunding.totalRequired,18)} ETH`]],'launch-confirm-total');
  try {
    await confirmLaunch(snapshot,()=>ctx.confirmFlowAction('',{title:'Confirm launch',confirmLabel:'Confirm and launch',content}),()=>performLaunch(reviewedPurchase));
  } catch(error){ctx.text('[data-create-preview]',publicError(error,'preview'));setCreateNoticeLevel('[data-create-preview]','error');updateCreateAvailability();}
 });
}

async function performLaunch(reviewedPurchase?:PurchaseQuote): Promise<void> {
  if (ctx.launchSubmitting) return;
  ctx.launchSubmitting = true;
  updateCreateAvailability();
  const form = ctx.required<HTMLFormElement>("[data-create-form]");
  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")];
  const disabledBefore = fields.map(field => field.disabled);
  let operation:LaunchOperation='publish_details';
  try {
    if (!ctx.required<HTMLFormElement>("[data-create-form]").reportValidity()) return;
    await ctx.verifyTransactionFoundation();
    if (!ctx.foundation?.writeReady || !ctx.runtimeConfig.contracts.available || !ctx.wallet || ctx.foundation.launchFee === undefined) {
      throw new Error(ctx.runtimeReasons().join("; ") || "Connect a wallet first");
    }
    if (ctx.launchImageReading) throw new Error("Loading image…");
    if (!ctx.launchImage) throw new Error("Add a token image.");
    ctx.launchProgress={version:1,id:crypto.randomUUID(),chainId:robinhoodChain.id,account:ctx.wallet.account,phase:'publishing',detail:'Publishing your token details and image. Keep this page open.'};
    saveLaunchState(localStorage,ctx.launchProgress);
    drawLaunchProgress();
    fields.forEach(field => { field.disabled = true; });
    const activeWallet = ctx.wallet;
    const contracts = ctx.runtimeConfig.contracts.value;
    await prepareLaunchMetadata();
    if (ctx.wallet !== activeWallet) throw new Error("Wallet changed while saving token details");
    updateLaunchProgress("preparing","Checking the launch settings and preparing your transaction.");
    const submittedDetails = launchDetails();
    const submittedMetadata = ctx.preparedMetadata;
    operation='preview_launch';
    const preview = await previewLaunch(activeWallet);
    ctx.launchPreview = preview;
    const propsForProgress=submittedMetadata?.properties as Record<string,unknown>|undefined;
    ctx.launchProgress!.expected={factory:contracts.factoryAddress,marketId:preview.marketId,token:preview.memeToken,curve:preview.curve,gauge:preview.gauge};
    ctx.launchProgress!.listing={chainId:robinhoodChain.id,chainName:robinhoodChain.name,tokenAddress:preview.memeToken,name:submittedDetails.name,symbol:submittedDetails.symbol,
      logo:typeof submittedMetadata?.image==='string'?submittedMetadata.image:'',website:typeof propsForProgress?.website==='string'?propsForProgress.website:submittedDetails.website,
      x:typeof propsForProgress?.x==='string'?propsForProgress.x:submittedDetails.x,metadataURI:preview.params.metadataURI,txHash:''};
    saveLaunchState(localStorage,ctx.launchProgress!);
    const verifyChain = () => ctx.ensureCanonicalLaunch(preview.selected);
    const previewEconomics = async () => preview.params.expectedEconomics;
    const mode = ctx.required<HTMLSelectElement>("[name=launchMode]").value;
    let request: ContractWriteRequest;
    let expectedSpent: bigint | null = null;
    let expectedMinimum: bigint | null = null;
    let requestedQuote: bigint | null = null;
    if (mode === "create") {
      const built = await buildCreateMarketRequest({
        factory: contracts.factoryAddress,
        launchFee: ctx.foundation.launchFee,
        config: preview.selected,
        previewMarketEconomics: previewEconomics,
      });
      request = built.request;
    } else {
      const decimals = await quoteDecimalsFor(preview.selected);
      const quoteIn = parseTokenAmount(ctx.required<HTMLInputElement>("[name=firstBuyAmount]").value, decimals, "First buy amount");
      requestedQuote = quoteIn;
    operation='refresh_funding';
      const freshFunding = await calculateLaunchFunding(preview);
      const requiredEth=freshFunding.totalRequired-(freshFunding.purchase?purchaseEthLimit(BigInt(freshFunding.purchase.amountIn)):0n)+(freshFunding.purchase&&reviewedPurchase?purchaseEthLimit(BigInt(reviewedPurchase.amountIn)):0n);
      ctx.launchFunding = {...freshFunding,totalRequired:requiredEth};
      renderLaunchFunding(ctx.launchFunding);
      if (freshFunding.ethBalance < requiredEth) throw new Error("ETH balance is below the estimated total required");
      if(freshFunding.purchase){
    operation='review_purchase';
        assertPurchaseWithinApproval(freshFunding.purchase,reviewedPurchase);
    operation='purchase_asset';
        await executeQuotePurchase(freshFunding.purchase,activeWallet,preview,purchaseEthLimit(BigInt(reviewedPurchase!.amountIn)));
      }
      const probe = await buildLaunchAndBuyRequests({
        router: ctx.foundation.bindings!.launchRouter,
        launchFee: ctx.foundation.launchFee,
        quoteIn,
        minTokensOut: 1n,
        recipient: preview.creator,
        config: preview.selected,
        previewMarketEconomics: previewEconomics,
      });
      if (probe.approval) {
    operation='approve_asset';
        await ctx.ensureStandaloneApproval(probe.approval, preview.selected.quote.quoteAsset, ctx.foundation.bindings!.launchRouter, quoteIn, ctx.foundation.sync, verifyChain, activeWallet,{businessType:'approval',marketId:preview.marketId,conflictKey:`launch:${preview.marketId}`});
      }
      await ctx.ensureCurrentRevision(ctx.foundation.sync.revision);
      await verifyChain();
      await ctx.verifyLiveWalletContext(activeWallet);
    operation='simulate_launch';
      const simulated = await ctx.publicClient.simulateContract({ ...probe.request, account: preview.creator } as never) as { result: unknown };
      const tokensOut = ctx.simulationTuple(simulated.result, 2, "first-buy output");
      const refund = ctx.simulationTuple(simulated.result, 3, "first-buy refund");
      if (tokensOut <= 0n || refund > quoteIn) throw new Error("Launch simulation returned an invalid first-buy result");
      expectedSpent = quoteIn - refund;
      expectedMinimum = tokensOut;
      const built = await buildLaunchAndBuyRequests({
        router: ctx.foundation.bindings!.launchRouter,
        launchFee: ctx.foundation.launchFee,
        quoteIn,
        minTokensOut: expectedMinimum,
        recipient: preview.creator,
        config: preview.selected,
        previewMarketEconomics: previewEconomics,
      });
      request = built.request;
    }
    operation='prepare_transaction';
    const estimatedLaunchGas = await ctx.publicClient.estimateContractGas({ ...request, account: preview.creator } as never);
    const paddedLaunchGas = (estimatedLaunchGas * 120n + 99n) / 100n;
    const gas = paddedLaunchGas > ctx.CONSERVATIVE_LAUNCH_GAS ? paddedLaunchGas : ctx.CONSERVATIVE_LAUNCH_GAS;
    const signingFees = await ctx.publicClient.estimateFeesPerGas();
    const signingFeePerGas = signingFees.maxFeePerGas ?? signingFees.gasPrice;
    if (signingFeePerGas === undefined) throw new Error("Network gas price is unavailable");
    if (await ctx.publicClient.getBalance({ address: preview.creator }) < (request.value ?? 0n) + gas * signingFeePerGas) throw new Error("ETH balance is below the transaction value plus current Gas budget");
    request = { ...request, gas };
    ctx.launchProgress!.data=encodeFunctionData({abi:request.abi,functionName:request.functionName,args:request.args} as never);
    ctx.launchProgress!.intent=JSON.stringify([request.address.toLowerCase(),request.functionName,request.args??[],request.value??0n],(_key,value)=>typeof value==='bigint'?value.toString():value);
    saveLaunchState(localStorage,ctx.launchProgress!);
    operation='submit_launch';
    let confirmedHash = "";
    const created = await ctx.executeTransaction({
      operationKey: `launch:${mode}:${preview.marketId}:${ctx.foundation.sync.revision}`,
      onUpdate:handleLaunchTransactionUpdate,
      sync: ctx.foundation.sync,
      request,
      quoteExpiresAtMs: Date.now() + 90_000,
      walletContext: activeWallet,
      verifyChain,
      confirm: async (receipt) => {
        operation='verify_launch';
        const result = findCanonicalMarketCreated(receipt, contracts.factoryAddress, {
          params: preview.params,
          quoteAsset: preview.selected.quote.quoteAsset,
        });
        if (result.marketId !== preview.marketId || result.memeToken !== preview.memeToken || result.curve !== preview.curve || result.gauge !== preview.gauge) {
          throw new Error("Created addresses differ from the Factory prediction");
        }
        if (mode === "create-buy") {
          ctx.receiptEvent(receipt, result.curve, v1Abis_TickerGardenCurve, "CurveBuy", (args) =>
            String(args.buyer).toLowerCase() === ctx.foundation!.bindings!.launchRouter
            && String(args.recipient).toLowerCase() === preview.creator
            && (expectedSpent === null ? typeof args.quoteIn === "bigint" && args.quoteIn > 0n && requestedQuote !== null && args.quoteIn <= requestedQuote : args.quoteIn === expectedSpent)
            && typeof args.tokensOut === "bigint"
            && expectedMinimum !== null
            && args.tokensOut >= expectedMinimum,
          );
        }
        const [code, quoteAsset, createdMarket] = await Promise.all([
          ctx.publicClient.getCode({ address: result.curve }),
          ctx.publicClient.readContract({ abi: v1Abis_TickerGardenCurve, address: result.curve, functionName: "quoteAsset" }),
          ctx.publicClient.readContract({ abi: launchAbis(preview.selected).MarketRegistryV1, address: ctx.foundation!.bindings!.marketRegistry, functionName: "market", args: [result.marketId], blockNumber: receipt.blockNumber }),
        ]);
        if (!code || code === "0x" || quoteAsset.toLowerCase() !== preview.selected.quote.quoteAsset) throw new Error("Fresh Curve deployment does not match the selected Quote");
        if (tupleField(tupleField(createdMarket, "config", 0), "stakingEnabled", 16) !== preview.params.stakingEnabled) throw new Error("Created staking mode differs from the signed choice");
        if (tupleField(tupleField(createdMarket, "config", 0), "creatorFeesToHolders", 15) !== preview.params.creatorFeesToHolders) throw new Error("Created holder fee sharing differs from the signed choice");
        if (preview.params.lpFeePips !== undefined && tupleField(tupleField(createdMarket, "config", 0), "lpFeePips", 18) !== preview.params.lpFeePips) throw new Error("Created LP fee differs from the signed choice");
        if (preview.params.burnMemeFees !== undefined && tupleField(tupleField(createdMarket, "config", 0), "burnMemeFees", 17) !== preview.params.burnMemeFees) throw new Error("Created token fee burn choice differs from the signed choice");
        ctx.directMarkets?.receipt(receipt);
        confirmedHash = receipt.transactionHash;
        return result;
      },
    });
    clearCreateDraft(localStorage, robinhoodChain.id); ctx.pendingCreateDraft = null;
    ctx.launchSalt = ctx.randomSalt();
    ctx.launchPreview = null;
    const props = submittedMetadata?.properties as Record<string,unknown> | undefined;
    ctx.latestListing = {marketId:created.marketId,snapshot:{chainId:robinhoodChain.id,chainName:robinhoodChain.name,tokenAddress:created.memeToken,
      name:submittedDetails.name,symbol:submittedDetails.symbol,logo:typeof submittedMetadata?.image==='string'?submittedMetadata.image:'',
      website:typeof props?.website==='string'?props.website:submittedDetails.website,
      x:typeof props?.x==='string'?props.x:submittedDetails.x,metadataURI:preview.params.metadataURI,txHash:confirmedHash}};
    ctx.creatorDirectoryAt=0;
    try { localStorage.setItem(`tg-listing:${robinhoodChain.id}`,JSON.stringify(ctx.latestListing)); } catch { /* Downloads still work without browser storage. */ }
    if(ctx.launchProgress?.listing)ctx.launchProgress.listing.txHash=confirmedHash;
    if(ctx.launchProgress){ctx.launchProgress={...ctx.launchProgress,phase:'complete',detail:LAUNCH_CONFIRMED_COPY};saveLaunchState(localStorage,ctx.launchProgress);}
    void notifyLaunchDatabase(confirmedHash,import.meta.env.VITE_V1_PIPELINE_URL).then(()=>ctx.snapshotPoller?.reconnect());
    await presentCompletedLaunch();
  } catch (error) {
    let failureMessage=publicError(error,'transaction');
    if(ctx.launchProgress){
      let purchasePending=true;try{purchasePending=Boolean(recoveryRead(localStorage,purchaseStateKey(ctx.launchProgress.account)));}catch{/* Unknown storage state retains the duplicate-submission guard. */}
      const pending=purchasePending||(ctx.launchProgress.phase!=='failed'&&Boolean(ctx.launchProgress.hash||['wallet','pending','confirming'].includes(ctx.launchProgress.phase)));
      ctx.launchProgress.diagnostic=await recordLaunchFailure(localStorage,ctx.launchProgress,operation,error,pending);
      failureMessage=launchFailureMessage(ctx.launchProgress.diagnostic.code,ctx.launchProgress.diagnostic.phase,pending);
      if(pending){
       updateLaunchProgress('paused',failureMessage);
       setTimeout(()=>void restoreLaunchProgress(),0);
      } else updateLaunchProgress('failed',failureMessage);
    }
    ctx.notify(failureMessage,ctx.launchProgress?.phase==='paused'?'warning':'error');
    scheduleLaunchPreview();
  } finally {
    fields.forEach((field, index) => { field.disabled = disabledBefore[index]!; });
    ctx.launchSubmitting = false;
    updateCreateAvailability();
  }
}
return {restoreLaunchProgress,renderDeveloperBuyBalance,updateCreateAvailability,drawLaunchProgress,updateLaunchProgress,renderCreateConfig,setupCreate};
}
