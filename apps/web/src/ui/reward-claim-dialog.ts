export type ClaimAssets = 1 | 2 | 3;
type ClaimSymbols = Readonly<{ quote: string; meme: string }>;

/** Present a confirmation for claiming the selected original reward assets. */
export function rewardClaimDialog(rawLabel: (assets: ClaimAssets) => string, symbols: ClaimSymbols): Promise<ClaimAssets | null> {
  return new Promise(resolve => {
    const dialog=document.createElement('dialog');dialog.className='reward-claim-dialog';
    dialog.innerHTML=`<form method="dialog"><header><h3>Claim rewards</h3><button value="cancel" aria-label="Close">×</button></header>
      <fieldset><legend>Choose assets</legend><label><input type="radio" name="assets" value="3" checked><span>All assets</span></label><label><input type="radio" name="assets" value="1"><span class="quote-label"></span></label><label><input type="radio" name="assets" value="2"><span class="meme-label"></span></label></fieldset>
      <p class="reward-claim-note"></p>
      <footer><button value="cancel" class="secondary-button">Cancel</button><button value="claim" class="primary-button">Claim</button></footer></form>`;
    dialog.querySelector<HTMLElement>('.quote-label')!.textContent=`${symbols.quote} only`;
    dialog.querySelector<HTMLElement>('.meme-label')!.textContent=`${symbols.meme} only`;
    document.body.append(dialog);
    const assets=()=>Number(dialog.querySelector<HTMLInputElement>('input[name="assets"]:checked')!.value) as ClaimAssets;
    const render=()=>{dialog.querySelector<HTMLElement>('.reward-claim-note')!.textContent=rawLabel(assets());};
    dialog.addEventListener('change',event=>{if((event.target as HTMLInputElement).name==='assets')render();});
    dialog.addEventListener('close',()=>{const result=dialog.returnValue==='claim'?assets():null;dialog.remove();resolve(result);},{once:true});
    dialog.showModal();
    render();
  });
}
