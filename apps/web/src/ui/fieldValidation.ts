export type FieldRule = {kind:'name'|'ticker'|'website'|'social'|'address'|'bytes32'|'amount'|'integer'|'tax';required?:boolean;allowZero?:boolean;decimals?:number;max?:number};
export function fieldError(raw:string,rule:FieldRule):string {
 const v=raw.trim();if(!v)return rule.required?'This field is required.':'';
 if(rule.kind==='name')return v.length>64?'Use at most 64 characters.':'';
 if(rule.kind==='ticker')return /^[A-Z0-9]{1,16}$/.test(v)?'':'Use 1–16 letters A–Z or digits 0–9.';
 if(rule.kind==='address'||rule.kind==='bytes32'){
  const n=rule.kind==='address'?40:64;
  if(!new RegExp(`^0x[0-9a-fA-F]{${n}}$`).test(v))return `Enter 0x followed by exactly ${n} hexadecimal characters.`;
  return !rule.allowZero&&/^0x0+$/.test(v)?'The zero value is not allowed.':'';
 }
 if(rule.kind==='website'||rule.kind==='social'){
  if(rule.kind==='social'&&/^@?[A-Za-z0-9_]{1,64}$/.test(v))return '';
  try{const s=rule.kind==='social'&&/^(x|twitter)\.com\//i.test(v)?'https://'+v:v;const u=new URL(s);
   if(!['http:','https:'].includes(u.protocol)||!u.hostname||u.username||u.password)throw Error();
   if(rule.kind==='social'&&(u.protocol!=='https:'||!['x.com','twitter.com'].includes(u.hostname)||u.port||u.search||u.hash||s.includes('?')||s.includes('#')||!/^\/[A-Za-z0-9_]{1,64}\/?$/.test(u.pathname)))throw Error();return '';
  }catch{return rule.kind==='social'?'Enter an X handle or an https://x.com/handle profile URL.':'Enter a complete http:// or https:// website URL without login credentials.';}
 }
 if(rule.kind==='integer'){
  if(!/^(0|[1-9][0-9]*)$/.test(v))return 'Enter a whole number without signs, decimals or exponent notation.';
  if(v.length>10)return `Enter a whole number no greater than ${rule.max??4294967295}.`;
  const n=BigInt(v);return n<BigInt(rule.allowZero?0:1)||n>BigInt(rule.max??4294967295)?`Enter a whole number from ${rule.allowZero?0:1} to ${rule.max??4294967295}.`:'';
 }
 if(!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(v))return 'Enter a plain decimal amount, without signs, commas or exponent notation.';
 const [whole,fraction='']=v.split('.'),decimals=rule.kind==='tax'?2:rule.decimals??18;
 if(fraction.length>decimals)return `Use at most ${decimals} decimal places.`;
 if(whole!.length>78)return 'Amount exceeds the supported token range.';
 const n=BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
 if(rule.kind==='tax')return n>500n?'Creator tax must be between 0% and 5%.':'';
 if(n===0n&&!rule.allowZero)return 'Enter an amount greater than zero.';
 return n>((1n<<256n)-1n)?'Amount exceeds the supported token range.':'';
}
type Field=HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
export function mountFieldValidation(root:HTMLElement,decimalsFor:(field:Field)=>number|undefined=()=>undefined):()=>void {
 const touched=new WeakSet<Field>();let sequence=0;
 const ruleFor=(f:Field):FieldRule|undefined=>{
  const required=f.required;
  if(f.name==='name')return {kind:'name',required};if(f.name==='symbol')return {kind:'ticker',required};
  if(f.name==='website')return {kind:'website'};if(f.name==='x')return {kind:'social'};
  if(['beneficiary','newBeneficiary','user','serviceCreditAsset'].includes(f.name))return {kind:'address',required,allowZero:f.name==='serviceCreditAsset'};
  if(f.name==='marketId'||f.matches('[data-market-id],[data-direct-vault-market]'))return {kind:'bytes32',required};
  if(f.name==='epoch')return {kind:'integer',required};
  if(f.name==='slippageBps')return {kind:'integer',required:true,allowZero:true,max:5000};
  if(f.name==='creatorTax')return {kind:'tax'};
  if(f.matches('[data-trade-amount],[data-reward-amount]')||f.name==='firstBuyAmount')return {kind:'amount',required,allowZero:f.name==='firstBuyAmount',decimals:decimalsFor(f)??18};
 };
 const eligible=(f:Element):f is Field=>(f instanceof HTMLInputElement||f instanceof HTMLSelectElement||f instanceof HTMLTextAreaElement)&&!f.disabled&&!(f instanceof HTMLInputElement&&(f.type==='hidden'||f.type==='checkbox'||f.type==='search'))&&!('readOnly' in f&&f.readOnly);
 const validate=(f:Field,show:boolean)=>{
  if(f instanceof HTMLInputElement&&f.name==='creatorTax'&&f.valueAsNumber>5)f.value='5';
  const rule=ruleFor(f);if(rule)f.setCustomValidity(fieldError(f.value,rule));
  const error=show&&!f.validity.valid?(f.validationMessage||'Check this field.') : '';
  let hint=f.dataset.validationHint?root.querySelector<HTMLElement>('#'+f.dataset.validationHint):null;
  if(!hint&&error){hint=document.createElement('small');hint.id=`field-validation-${++sequence}`;hint.className='field-error';hint.setAttribute('role','status');f.dataset.validationHint=hint.id;const holder=f.closest('.field');if(holder)holder.append(hint);else (f.closest('.ref-input-box')??f).insertAdjacentElement('afterend',hint);}
  if(hint){hint.textContent=error;hint.hidden=!error;const ids=(f.getAttribute('aria-describedby')??'').split(/\s+/).filter(id=>id&&id!==hint!.id);if(error)ids.push(hint.id);if(ids.length)f.setAttribute('aria-describedby',ids.join(' '));else f.removeAttribute('aria-describedby');}
  if(error)f.setAttribute('aria-invalid','true');else f.removeAttribute('aria-invalid');return !error;
 };
 const update=(e:Event)=>{if(!(e.target instanceof Element)||!eligible(e.target))return;const f=e.target;touched.add(f);if(f.name==='symbol')f.value=f.value.toUpperCase();validate(f,true);if(e.type==='change')for(const other of root.querySelectorAll('input,select,textarea'))if(other!==f&&eligible(other)&&touched.has(other))validate(other,true);};
 const submit=(e:Event)=>{if(!(e.target instanceof HTMLFormElement))return;let first:Field|undefined;for(const f of e.target.querySelectorAll('input,select,textarea'))if(eligible(f)){touched.add(f);validate(f,true);if(!f.validity.valid)first??=f;}if(first){e.preventDefault();e.stopImmediatePropagation();first.focus();}};
 for(const event of ['input','change','focusout','invalid'])root.addEventListener(event,update,true);
 root.addEventListener('submit',submit,true);
 return ()=>{for(const event of ['input','change','focusout','invalid'])root.removeEventListener(event,update,true);root.removeEventListener('submit',submit,true);};
}
