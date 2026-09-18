export type TradeConfirmation = {
  pay: {amount:string;symbol:string;logo?:string};
  receive: {amount:string;symbol:string;logo?:string};
  minimum:string;
  impact:string;
  conversion?:{route:string;minimum:string;fee:string};
};
/** Presentation only: all amounts are supplied by the already-reviewed trade quote. */
export function tradeConfirmationContent(data:TradeConfirmation):HTMLElement {
  const content=document.createElement('section');content.className='trade-confirm-content';
  const assets=document.createElement('div');assets.className='trade-confirm-assets';
  for(const [label,asset] of [['You pay',data.pay],['You receive',data.receive]] as const){
    const card=document.createElement('div');card.className='trade-confirm-asset';
    const caption=document.createElement('span');caption.className='trade-confirm-caption';caption.textContent=label;
    const body=document.createElement('div');body.className='trade-confirm-asset-body';
    const amount=document.createElement('strong');amount.className='trade-confirm-amount';amount.textContent=asset.amount;
    const badge=document.createElement('span');badge.className='trade-confirm-symbol';
    if(asset.logo){const image=document.createElement('img');image.src=asset.logo;image.alt='';image.width=24;image.height=24;image.onerror=()=>image.remove();badge.append(image);}
    const symbol=document.createElement('span');symbol.textContent=asset.symbol;badge.append(symbol);
    body.append(amount,badge);card.append(caption,body);assets.append(card);
  }
  const details=document.createElement('dl');details.className='trade-confirm-details';
  const row=(label:string,value:string,emphasis=false)=>{const line=document.createElement('div');if(emphasis)line.className='trade-confirm-minimum';const term=document.createElement('dt');term.textContent=label;const description=document.createElement('dd');description.textContent=value;line.append(term,description);details.append(line);};
  if(data.conversion){row('Route',data.conversion.route);row('Conversion minimum (1% tolerance)',data.conversion.minimum);row('Conversion fee',data.conversion.fee);}
  row('Market price impact',data.impact);
  row('Minimum received',data.minimum,true);
  content.append(assets,details);return content;
}
