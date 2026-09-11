export function validStakeAmountDraft(value:string,decimals:number):boolean{
 if(!Number.isInteger(decimals)||decimals<0||decimals>18||value.length>80)return false;
 if(!/^(?:0|[1-9]\d*)?(?:\.\d*)?$/.test(value))return false;
 if(decimals===0&&value.includes('.'))return false;
 const [whole='',fraction='']=value.split('.');
 if(fraction.length>decimals)return false;
 return BigInt((whole||'0')+fraction.padEnd(decimals,'0'))<=(1n<<256n)-1n;
}
export function bindStakeAmountInput(input:HTMLInputElement,decimals:()=>number,changed:()=>void){
 let previous=input.value;
 const accepts=(value:string)=>validStakeAmountDraft(value,decimals());
 const candidate=(insert:string)=>input.value.slice(0,input.selectionStart??input.value.length)+insert+input.value.slice(input.selectionEnd??input.value.length);
 input.addEventListener('beforeinput',event=>{previous=input.value;if(event.data!==null&&!accepts(candidate(event.data)))event.preventDefault();});
 input.addEventListener('paste',event=>{previous=input.value;const value=event.clipboardData?.getData('text');if(value!==undefined&&!accepts(candidate(value)))event.preventDefault();});
 input.addEventListener('input',()=>{if(!accepts(input.value))input.value=previous;else if(input.value.startsWith('.'))input.value=`0${input.value}`;previous=input.value;changed();});
}
