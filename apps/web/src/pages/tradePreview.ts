import { referencePriceTrace } from './referenceChart.ts';
import './tradeReference.css';
const assets: Record<string,string> = {
  cat: new URL('../../assets/detail-reference/gcat-avatar.png', import.meta.url).href,
  creator: new URL('../../assets/detail-reference/creator-avatar.png', import.meta.url).href,
  eth: new URL('../../assets/detail-reference/eth-icon.png', import.meta.url).href,
  plant: new URL('../../assets/detail-reference/plant-icon.png', import.meta.url).href,
  tradeEth: new URL('../../assets/detail-reference/trade-eth.png', import.meta.url).href,
  nvda: new URL('../../assets/detail-reference/nvda-icon.png', import.meta.url).href,
};
const icon = (name: string) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
const img = (name: string, cls = '') => `<img class="${cls}" src="${assets[name]}" alt="" />`;
const about = 'A community token for cat lovers, built on Robinhood, grown in the garden.';
const trades = [
  ['3:24:17 PM','Buy','0.0000283','12,500','0.3538','0x3aF2…9c1D'],
  ['3:21:03 PM','Sell','0.0000279','8,420','0.2351','0x9B7e…4d2A'],
  ['3:19:41 PM','Buy','0.0000276','25,000','0.6900','0x1C4b…8F0e'],
  ['3:16:22 PM','Buy','0.0000271','5,000','0.1355','0x7D9a…3c6B'],
  ['3:14:08 PM','Sell','0.0000269','18,900','0.5084','0x2Ee1…5A9f'],
];

/** Isolated sample surface: no production trade selectors or transaction handlers. */
export function mountTradePreview(outlet: HTMLElement): void {
  outlet.innerHTML = `<main class="ref-detail">
    <header class="ref-hero">
      ${img('cat','ref-avatar')}
      <div class="ref-identity"><h1><span class="ref-token-symbol">GCAT</span><span class="ref-token-name">Garden Cat</span></h1>
        <div class="ref-meta"><div><span>Contract</span><button aria-label="Copy sample contract" data-ref-copy>${icon('copy')}</button><span class="ref-address">0xA1B2…C3D4</span></div><div><span>Created by</span><span class="ref-address">0x7F9a…2e1C</span></div><div class="ref-launched"><small>Launched</small><time>Sep 8, 2026</time></div></div>
      </div>
      <aside class="ref-hero-right"><section class="ref-fee-overview" aria-label="Protocol fee allocation"><header><span>FEE ALLOCATION</span><button type="button" data-ref-fee-details>Details ${icon('arrow-up-right')}</button></header><div class="ref-fee-metrics"><div><strong>40<span>%</span></strong><small>Creator</small></div><div><strong>30<span>%</span></strong><small>Stakers</small></div><div><strong>30<span>%</span></strong><small>Platform</small></div></div><div class="ref-fee-bar" role="img" aria-label="40 percent creator, 30 percent stakers, 30 percent platform"><span></span><span></span><span></span></div></section></aside>
    </header>
    <div class="ref-columns">
      <aside class="ref-card ref-about"><h2>About</h2><p class="ref-description">${about}</p>
        <dl><div><dt>Symbol</dt><dd>GCAT</dd></div><div><dt>Fixed supply</dt><dd>1,000,000,000 GCAT</dd></div><div><dt>Circulating supply</dt><dd>Unavailable</dd></div><div><dt>Market cap</dt><dd>Unavailable <button title="Market capitalization is unavailable in this sample" aria-label="Market cap information">${icon('info')}</button></dd></div><div><dt>Holders</dt><dd>1,284</dd></div></dl>
        <section class="ref-links"><h3>Links</h3><button type="button" data-ref-link="Website">${icon('globe-hemisphere-west')}Website ${icon('arrow-square-out')}</button><button type="button" data-ref-link="X account">${icon('x-logo')}X account ${icon('arrow-square-out')}</button></section>
        <section class="ref-assets"><h3>Quote asset</h3><div>${img('eth','ref-asset-icon')}<p><strong>ETH</strong><small>Traded on Uniswap v4</small></p></div><h3>Staking base</h3><div>${img('nvda','ref-asset-icon')}<p><strong>NVDA</strong><small>Optional · Earn fees</small></p></div></section>
        <div class="ref-community">${icon('users-three')}<p><strong>Community owned.</strong><small>Fee distribution goes to participants,<br>not a central team.</small></p></div>
      </aside>
      <div class="ref-center">
      <section class="ref-card ref-market">
        <div class="ref-overview-heading"><h2>Market overview</h2><div class="ref-periods" role="group" aria-label="Chart timeframe">${['1H','6H','1D','1W','1M','ALL'].map((v,i)=>`<button class="${i===0?'active':''}" data-ref-period="${v}" aria-pressed="${i===0}">${v}</button>`).join('')}</div></div>
        <div class="ref-stats"><div><small>Price (ETH)</small><strong>0.0000283</strong><span class="ref-positive">+12.4% (1H)</span></div><div><small>24h volume</small><strong>86.4 ETH</strong></div></div>
        <div class="ref-chart"><canvas aria-label="Illustrative GCAT price chart" role="img"></canvas></div>

        <section class="ref-activity"><header><div role="tablist" aria-label="Market activity"><button class="active" role="tab" aria-selected="true" data-ref-tab="trades">Recent trades</button><button role="tab" aria-selected="false" data-ref-tab="holders">Holders</button></div><button class="ref-view-all" data-ref-all>View all ${icon('arrow-square-out')}</button></header><div class="ref-table-wrap" data-ref-panel="trades"><table><thead><tr>${['Time','Type','Price (ETH)','Amount (GCAT)','Value (ETH)','Trader'].map(v=>`<th>${v}</th>`).join('')}</tr></thead><tbody>${trades.map(row=>`<tr>${row.map((v,i)=>`<td class="${i===1?v.toLowerCase():''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="ref-table-wrap" data-ref-panel="holders" hidden><table><thead><tr><th>Holder</th><th>Balance (GCAT)</th><th>Share</th></tr></thead><tbody>${[['0x3aF2…9c1D','42,500,000','4.25%'],['0x9B7e…4d2A','31,200,000','3.12%'],['0x1C4b…8F0e','25,000,000','2.50%'],['0x7D9a…3c6B','18,750,000','1.88%']].map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
      </section>
        <section class="ref-card ref-fees" tabindex="-1" aria-label="Fee distribution details"><header>${icon('coins')}<h3>Fee distribution</h3><span class="ref-badge">Staking active · holder sharing off</span><small>Fee percentages apply to protocol fees.</small></header><div class="ref-fee-rows">${[['40%','Creator','Supports the creator'],['30%','Stakers','Distributed to NVDA stakers'],['30%','Platform','Helps grow TickerGarden']].map(([pct,name,note])=>`<div><strong>${pct}</strong><b>${name}</b><span>${note}</span><p><small>Total distributed</small>Unavailable</p></div>`).join('')}</div></section>
      </div>
      <aside class="ref-right"><form class="ref-card ref-trade" data-ref-mode="buy"><h2>Trade GCAT</h2><div class="ref-side" role="group" aria-label="Trade side"><button type="button" class="active" aria-pressed="true" data-ref-side="buy">Buy</button><button type="button" aria-pressed="false" data-ref-side="sell">Sell</button></div>
        <label for="ref-pay">Pay with</label><div class="ref-input-box"><button type="button" class="ref-token" data-ref-token="pay">${img('tradeEth')}<span>ETH</span>${icon('caret-down')}</button><div class="ref-amount"><input id="ref-pay" inputmode="decimal" type="number" min="0" step="any" placeholder="0.0" aria-label="Amount to pay"><small>≈ $0.00</small></div></div><p class="ref-balance">Balance: —</p>
        <button type="button" class="ref-swap" data-ref-swap aria-label="Reverse trade direction">${icon('arrows-clockwise')}</button>
        <label for="ref-receive">Receive</label><div class="ref-input-box ref-receive"><button type="button" class="ref-token" data-ref-token="receive">${img('cat')}<span>GCAT</span>${icon('caret-down')}</button><output id="ref-receive">0.0</output></div><p class="ref-balance">Balance: —</p>
        <div class="ref-quote"><div><span>Price</span><strong>0.0000283 ETH</strong></div><div><span>Slippage tolerance</span><button type="button" data-ref-slippage><span>0.5%</span> ${icon('pencil-simple')}</button></div><div><span>Trading fee <button type="button" aria-label="Trading fee information" title="Illustrative fee only; actual fees require an on-chain quote">${icon('info')}</button></span><strong>0.3%</strong></div><div><span>Minimum received <button type="button" aria-label="Minimum received information" title="Illustrative output after fees and slippage">${icon('info')}</button></span><strong data-ref-minimum>0.0 GCAT</strong></div></div>
        <button type="button" class="ref-connect" data-ref-connect>${icon('wallet')}Connect wallet</button><p class="ref-confirm">You’ll confirm the transaction in your wallet.</p>
      </form><div class="ref-card ref-risk"><span>${img('plant')}</span><p><strong>Trade responsibly.</strong><small>Tokens are volatile. Do your own research<br>and only invest what you can afford to lose.</small></p></div></aside>
    </div>
    <div class="ref-toast" role="status" hidden></div>
    <dialog class="ref-dialog"><h2>Design preview</h2><p>This page uses illustrative data. Wallet connection and transactions are disabled in this preview.</p><button type="button" data-ref-close>Got it</button></dialog>
  </main>`;
  const root = outlet.querySelector<HTMLElement>('.ref-detail')!;
  const q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const modal = q<HTMLDialogElement>('dialog');
  q('[data-ref-close]').onclick=()=>modal.close();
  q('[data-ref-fee-details]').onclick=()=>{const details=q('.ref-fees');details.scrollIntoView({behavior:'smooth',block:'center'});details.focus({preventScroll:true});};
  q('[data-ref-connect]').onclick=()=>modal.showModal();
  q<HTMLFormElement>('form').onsubmit=e=>e.preventDefault();
  for(const button of root.querySelectorAll<HTMLElement>('[data-ref-token]')) button.onclick=()=>modal.showModal();
  for(const button of root.querySelectorAll<HTMLElement>('[data-ref-link]')) button.onclick=()=>{q('.ref-toast').textContent=`${button.dataset.refLink} URL is not configured for this sample token.`;q('.ref-toast').hidden=false;};
  q('[data-ref-copy]').onclick=()=>{q('.ref-toast').textContent='Sample contract — no live address to copy.';q('.ref-toast').hidden=false;};
  let side='buy',slippage=.5;
  const amount=q<HTMLInputElement>('#ref-pay');
  const update=()=>{const value=Math.max(0,Number(amount.value)||0); const out=value*.997*(side==='buy'?1/.0000283:.0000283); const unit=side==='buy'?'GCAT':'ETH';q('output').textContent=out?out.toLocaleString('en-US',{maximumFractionDigits:side==='buy'?2:6}):'0.0';q('[data-ref-minimum]').textContent=`${out?(out*(1-slippage/100)).toLocaleString('en-US',{maximumFractionDigits:side==='buy'?2:6}):'0.0'} ${unit}`;};
  const changeSide=(next:string)=>{side=next;q('.ref-trade').dataset.refMode=side;for(const b of root.querySelectorAll<HTMLElement>('[data-ref-side]')){b.classList.toggle('active',b.dataset.refSide===side);b.setAttribute('aria-pressed',String(b.dataset.refSide===side));}q('[data-ref-token="pay"]').innerHTML=img(side==='buy'?'tradeEth':'cat')+`<span>${side==='buy'?'ETH':'GCAT'}</span>`+icon('caret-down');q('[data-ref-token="receive"]').innerHTML=img(side==='buy'?'cat':'tradeEth')+`<span>${side==='buy'?'GCAT':'ETH'}</span>`+icon('caret-down');update();};
  for(const b of root.querySelectorAll<HTMLElement>('[data-ref-side]'))b.onclick=()=>changeSide(b.dataset.refSide!);
  q('[data-ref-swap]').onclick=()=>changeSide(side==='buy'?'sell':'buy');amount.oninput=update;
  q('[data-ref-slippage]').onclick=()=>{slippage=slippage===.5?1:.5;q('[data-ref-slippage] span').textContent=`${slippage}%`;update();};
  for(const b of root.querySelectorAll<HTMLElement>('[data-ref-tab]'))b.onclick=()=>{for(const tab of root.querySelectorAll('[data-ref-tab]')){tab.classList.toggle('active',tab===b);tab.setAttribute('aria-selected',String(tab===b));}for(const p of root.querySelectorAll<HTMLElement>('[data-ref-panel]'))p.hidden=p.dataset.refPanel!==b.dataset.refTab;};
  q('[data-ref-all]').onclick=()=>{q('.ref-toast').textContent='All illustrative records are shown.';q('.ref-toast').hidden=false;};
  let period='1H';
  const draw=()=>drawChart(q<HTMLCanvasElement>('canvas'),period);
  for(const b of root.querySelectorAll<HTMLElement>('[data-ref-period]'))b.onclick=()=>{period=b.dataset.refPeriod!;for(const p of root.querySelectorAll('[data-ref-period]')){p.classList.toggle('active',p===b);p.setAttribute('aria-pressed',String(p===b));}q('.ref-positive').textContent=`+12.4% (${period})`;draw();};
  requestAnimationFrame(draw);
  const observer=new ResizeObserver(draw);observer.observe(q('.ref-chart'));
  // Disconnect once this route is removed, without keeping global event listeners.
  const removal=new MutationObserver(()=>{if(!root.isConnected){observer.disconnect();removal.disconnect();}});removal.observe(outlet,{childList:true});
}
function drawChart(canvas:HTMLCanvasElement,period:string){
  const box=canvas.getBoundingClientRect(),scale=devicePixelRatio||1;canvas.width=box.width*scale;canvas.height=box.height*scale;const c=canvas.getContext('2d')!;c.scale(scale,scale);
  const w=box.width,h=box.height,left=75,right=w-3,top=8,bottom=h-28;c.font='12px Arial';c.fillStyle='#718091';c.lineWidth=.6;
  ['0.000031','0.000028','0.000025','0.000022','0.000019'].forEach((v,i)=>{const y=top+12+(bottom-top-12)*i/4;c.fillText(v,1,y+5);c.strokeStyle='#e7ebe5';c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();});
  const labels=period==='1H'?['10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM']:['00:00','04:00','08:00','12:00','16:00','20:00'];labels.forEach((v,i)=>{if(w<450&&i%2!==0)return;const x=left+(right-left)*i/6;c.fillText(v,x-24,h-5);c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();});
  const pts=referencePriceTrace.map((v,i)=>[left+(right-left)*i/(referencePriceTrace.length-1),bottom-v*(bottom-top)]);
  const gradient=c.createLinearGradient(0,top,0,bottom);gradient.addColorStop(0,'#a4c58799');gradient.addColorStop(1,'#eaf1df55');c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x!,y!):c.moveTo(x!,y!));c.lineTo(right,bottom);c.lineTo(left,bottom);c.closePath();c.fillStyle=gradient;c.fill();c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x!,y!):c.moveTo(x!,y!));c.strokeStyle='#08752b';c.lineWidth=1.8;c.stroke();
}
