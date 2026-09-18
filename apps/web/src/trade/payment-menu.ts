/** Present the existing payment select with asset artwork instead of a native menu. */
export function renderPaymentMenu(select:HTMLSelectElement,iconFor:(symbol:string)=>string|undefined):void {
 const host=select.parentElement,trigger=host?.querySelector<HTMLButtonElement>('[data-trade-payment-trigger]'),menu=host?.querySelector<HTMLElement>('[data-trade-payment-menu]');
 if(!trigger||!menu)return;
 trigger.disabled=select.hidden||select.disabled;
 if(!trigger.dataset.bound){
  trigger.dataset.bound='true';
  const close=()=>{if(menu.matches(':popover-open'))menu.hidePopover();};
  const open=()=>{
   if(trigger.disabled)return;
   const rect=trigger.getBoundingClientRect();
   menu.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-196))}px`;
   menu.style.top=`${Math.max(8,Math.min(rect.bottom+8,innerHeight-180))}px`;
   menu.showPopover();
   menu.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  };
  trigger.addEventListener('click',()=>menu.matches(':popover-open')?close():open());
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open();}});
  menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
  menu.addEventListener('keydown',event=>{
   const buttons=[...menu.querySelectorAll<HTMLButtonElement>('[role=option]')];
   const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
   const next=event.key==='ArrowDown'?(index+1)%buttons.length:event.key==='ArrowUp'?(index-1+buttons.length)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:-1;
   if(next>=0){event.preventDefault();buttons[next]?.focus();}
   if(event.key==='Escape'){event.preventDefault();close();trigger.focus();}
   if(event.key==='Tab')close();
  });
  menu.addEventListener('click',event=>{
   const item=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[role=option]'):null;
   if(!item||trigger.disabled)return;
   close();trigger.focus();
   if(select.value===item.value)return;
   select.value=item.value;select.dispatchEvent(new Event('change',{bubbles:true}));
  });
 }
 if(trigger.disabled&&menu.matches(':popover-open'))menu.hidePopover();
 const key=JSON.stringify([...select.options].map(o=>[o.value,o.textContent,o.selected]));
 if(menu.dataset.options===key)return;
 menu.dataset.options=key;menu.replaceChildren();
 for(const option of select.options){
  const button=document.createElement('button');button.type='button';button.value=option.value;button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.selected));button.tabIndex=option.selected?0:-1;
  const image=document.createElement('img');const source=iconFor(option.textContent??'');if(source)image.src=source;image.alt='';image.width=24;image.height=24;
  const text=document.createElement('span');text.textContent=option.textContent;
  button.append(image,text);menu.append(button);
 }
}
