export type ClaimAssets = 1 | 2 | 3;
type ClaimSymbols = Readonly<{ quote: string; meme: string }>;

/** Present a confirmation for claiming the selected original reward assets. */
export function rewardClaimDialog(symbols: ClaimSymbols, availableAssets: ClaimAssets = 3, burnMemeFees = false): Promise<ClaimAssets | null> {
  return new Promise(resolve => {
    const dialog=document.createElement('dialog');dialog.className='reward-claim-dialog';dialog.setAttribute('aria-labelledby','reward-claim-title');
    dialog.innerHTML=`<form method="dialog"><header><div class="reward-claim-heading"><span class="reward-claim-mark" aria-hidden="true">✓</span><div><small>REWARD PAYOUT</small><h3 id="reward-claim-title">Claim rewards</h3></div></div><button value="cancel" aria-label="Close"><span aria-hidden="true">×</span></button></header>
      <fieldset><legend>Choose what to receive</legend><label><input type="radio" name="assets" value="3" checked><span><strong>All assets</strong><small>Receive both rewards</small></span></label><label><input type="radio" name="assets" value="1"><span><strong class="quote-label"></strong><small>Paired asset only</small></span></label><label><input type="radio" name="assets" value="2"><span><strong class="meme-label"></strong><small>Created token only</small></span></label></fieldset>
      <footer><button value="cancel" class="secondary-button">Cancel</button><button value="claim" class="primary-button">Claim</button></footer></form>`;
    dialog.querySelector<HTMLElement>('.quote-label')!.textContent=symbols.quote;
    dialog.querySelector<HTMLElement>('.meme-label')!.textContent=symbols.meme;
    for (const input of dialog.querySelectorAll<HTMLInputElement>('input[name="assets"]')) {
      const mask=Number(input.value); input.disabled=(mask & availableAssets)!==mask;
      input.checked=mask===availableAssets;
      input.closest('label')!.hidden=input.disabled;
    }
    if (burnMemeFees) {
      dialog.querySelector('fieldset')!.hidden=true;
      dialog.querySelector('h3')!.textContent=availableAssets===2?'Burn fee rewards':`Claim ${symbols.quote} & burn ${symbols.meme} fees`;
      dialog.querySelector<HTMLButtonElement>('button[value="claim"]')!.textContent=availableAssets===2?'Burn fees':'Claim & burn';
    }
    document.body.append(dialog);
    const assets=()=>Number(dialog.querySelector<HTMLInputElement>('input[name="assets"]:checked')!.value) as ClaimAssets;
    dialog.addEventListener('close',()=>{const result=dialog.returnValue==='claim'?assets():null;dialog.remove();resolve(result);},{once:true});
    dialog.showModal();
  });
}
