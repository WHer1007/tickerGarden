export type ClaimAssets = 1 | 2 | 3;
export type RewardClaimChoice = Readonly<{ assets: ClaimAssets; convert: boolean; rawFallback: boolean }>;
type ClaimLabels = Readonly<{ quote: string; meme: string }>;

/** The estimate is informational. No minimum received or slippage floor is added. */
export function rewardClaimDialog(estimate: (assets: ClaimAssets) => Promise<string>, rawLabel: (assets: ClaimAssets) => string, labels: Partial<ClaimLabels> = {}): Promise<RewardClaimChoice | null> {
  return new Promise(resolve => {
    const dialog=document.createElement('dialog');dialog.className='reward-claim-dialog';
    dialog.innerHTML=`<form method="dialog"><header><h3>Claim Rewards</h3><button value="cancel" aria-label="Close">×</button></header>
      <fieldset><legend>Choose Assets</legend><label><input type="radio" name="assets" value="3" checked><span>All Assets</span></label><label><input type="radio" name="assets" value="1"><span class="quote-label"></span></label><label><input type="radio" name="assets" value="2"><span class="meme-label"></span></label></fieldset>
      <label class="reward-claim-option"><input type="radio" name="mode" value="convert" checked><span>Convert And Claim<small>Receive Your Rewards In The Paired Asset.</small></span></label>
      <label class="reward-claim-option"><input type="radio" name="mode" value="raw"><span>Claim Original Assets<small>Receive Selected Assets Without Conversion.</small></span></label>
      <div class="reward-claim-estimate" role="status">Loading Estimate…</div>
      <label class="reward-claim-fallback"><input type="checkbox" name="fallback"><span>Receive Remaining Meme If Conversion Fails Or Is Partial</span></label>
      <p class="reward-claim-note">Actual Output May Differ. No Price Protection.</p>
      <footer><button value="cancel" class="secondary-button">Cancel</button><button value="claim" class="primary-button">Claim</button></footer></form>`;
    dialog.querySelector<HTMLElement>('.quote-label')!.textContent=`${labels.quote ?? 'Quote'} Only`;
    dialog.querySelector<HTMLElement>('.meme-label')!.textContent=`${labels.meme ?? 'Meme'} Only`;
    document.body.append(dialog);
    const assets=()=>Number(dialog.querySelector<HTMLInputElement>('input[name="assets"]:checked')!.value) as ClaimAssets;
    const raw=dialog.querySelector<HTMLInputElement>('input[value="raw"]')!;
    const convert=dialog.querySelector<HTMLInputElement>('input[value="convert"]')!;
    const fallback=dialog.querySelector<HTMLInputElement>('input[name="fallback"]')!;
    let estimateLabel='Loading Estimate…', request=0, closed=false;
    let estimatedAssets: ClaimAssets | null = null;
    const render=()=>{const selected=assets(), quoteOnly=selected===1;if(quoteOnly){raw.checked=true;convert.checked=false;}convert.disabled=quoteOnly;fallback.disabled=raw.checked||quoteOnly;dialog.querySelector<HTMLElement>('.reward-claim-fallback')!.hidden=raw.checked||quoteOnly;dialog.querySelector<HTMLElement>('.reward-claim-estimate')!.textContent=raw.checked?rawLabel(selected):estimateLabel;};
    const refresh=()=>{const selected=assets(), token=++request;estimateLabel='Loading Estimate…';estimatedAssets=null;render();if(selected===1||raw.checked)return;estimatedAssets=selected;void estimate(selected).then(v=>{if(!closed&&token===request){estimateLabel=v;render();}}).catch(()=>{if(!closed&&token===request){estimateLabel='Conversion Estimate Unavailable. You Can Claim Original Assets.';render();}});};
    dialog.addEventListener('change',event=>{if((event.target as HTMLInputElement).name==='assets')refresh();else {render();if(!raw.checked&&estimatedAssets!==assets())refresh();}});
    dialog.addEventListener('close',()=>{closed=true;request++;const selected=assets();const result=dialog.returnValue==='claim'?{assets:selected,convert:selected!==1&&!raw.checked,rawFallback:selected!==1&&!raw.checked&&fallback.checked}:null;dialog.remove();resolve(result);},{once:true});
    dialog.showModal();
    render(); refresh();
  });
}
