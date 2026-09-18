/** Six significant digits using decimal strings, never floating-point conversion. */
function roundedPrice(value:string|undefined|null):string {
 if(!value||!/^\d+(?:\.\d+)?$/.test(value))return '-';
 const [whole,fraction='']=value.split('.');
 const places=Math.max(0,6-(whole!.replace(/^0+/,'').length||-(fraction.match(/^0*/)?.[0].length??0)));
 if(fraction.length<=places)return value.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 let digits=BigInt(whole!+fraction.slice(0,places));
 if(Number(fraction[places])>=5)digits++;
 const raw=digits.toString().padStart(places+1,'0');
 return places?(raw.slice(0,-places)+'.'+raw.slice(-places)).replace(/0+$/,'').replace(/\.$/,''):raw;
}

/** Subscript counts ALL consecutive zeros after the decimal point. Display only. */
export function compactPrice(value:string|undefined|null):string {
 const rounded=roundedPrice(value),match=/^0\.(0{4,})([1-9]\d*)$/.exec(rounded);
 if(!match)return rounded;
 const count=String(match[1]!.length).replace(/\d/g,d=>'₀₁₂₃₄₅₆₇₈₉'[Number(d)]!);
 return `0.0${count}${match[2]}`;
}

const copyDocuments=new WeakSet<Document>();
/** Preserve the exact quote for hover, accessibility and copying a whole price. */
export function setPriceDisplay(node:HTMLElement,value:string|null|undefined,suffix=''):void {
 const formatted=compactPrice(value),exact=formatted==='-'?'':`${value}${suffix}`;
 const shown=formatted==='-'?'-':`${formatted}${suffix}`;
 if(node.textContent!==shown)node.textContent=shown;
 node.title=exact;node.dataset.exactPrice=exact;
 if(exact)node.setAttribute('aria-label',exact);else node.removeAttribute('aria-label');
 const doc=node.ownerDocument;if(!doc||copyDocuments.has(doc))return;copyDocuments.add(doc);
 doc.addEventListener('copy',event=>{
  const selection=doc.getSelection();
  const anchor=selection?.anchorNode;
  const owner=(anchor?.nodeType===1?anchor as Element:anchor?.parentElement)?.closest<HTMLElement>('[data-exact-price]');
  if(!owner)return;
  // Do not replace larger table/paragraph selections or partially selected numbers.
  if(!event.clipboardData||!owner.dataset.exactPrice||selection?.toString()!==owner.textContent||!selection.anchorNode||!selection.focusNode||!owner.contains(selection.anchorNode)||!owner.contains(selection.focusNode))return;
  event.clipboardData.setData('text/plain',owner.dataset.exactPrice);event.preventDefault();
 });
}
