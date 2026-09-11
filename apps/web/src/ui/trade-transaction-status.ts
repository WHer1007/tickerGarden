import type {TransactionUpdate} from '../v1/transaction.ts';

export type TradeStatusContext={side:'buy'|'sell';symbol:string;inputSymbol:string};
export function tradeStatusLabel(stage:TransactionUpdate['stage'],approval:boolean,context?:TradeStatusContext):string{
 const action=approval?'Approval':context?.side==='buy'?'Buy':context?.side==='sell'?'Sell':'Transaction';
 const asset=approval?context?.inputSymbol:context?.symbol;
 const state:Record<TransactionUpdate['stage'],string>={preflight:'Preparing',simulating_approval:'Checking',awaiting_approval_signature:'Confirm In Wallet',approval_submitted:'Pending',approval_confirmed:'Confirmed',simulating:'Preparing',awaiting_signature:'Confirm In Wallet',submitted:'Submitted',pending:'Pending',replaced:'Replaced',confirming:'Confirming',confirmed:'Confirmed',unknown:'Checking Status',failed:'Failed'};
 return `${action} ${state[stage]}${asset?` · ${asset}`:''}`;
}

/** A compact, persistent-in-page receipt status; only transaction hashes are displayed. */
export function createTradeTransactionStatus(explorer:string){
 let panel:HTMLElement|undefined,operation='',hash='',approval=false,approvalConfirmed=false;
 let dismissTimer:ReturnType<typeof setTimeout>|undefined;
 const dismiss=()=>{clearTimeout(dismissTimer);dismissTimer=undefined;panel?.remove();panel=undefined;};
 return {
  update(update:TransactionUpdate,context?:TradeStatusContext){
   if(operation!==update.operationKey){operation=update.operationKey;hash='';approval=update.operationKey.includes('approval');approvalConfirmed=false;}
   if(update.hash)hash=update.hash;
   if(update.stage==='approval_submitted'){approval=true;approvalConfirmed=false;}
   if(update.stage==='approval_confirmed'){approval=true;approvalConfirmed=true;}
   if(update.stage==='submitted'){approval=update.operationKey.includes('approval');approvalConfirmed=false;}
   const stage=approvalConfirmed&&['simulating','awaiting_signature'].includes(update.stage)?'approval_confirmed':update.stage;
   if(!hash)return;
   clearTimeout(dismissTimer);dismissTimer=undefined;
   if(!panel){panel=document.createElement('section');panel.className='trade-tx-status';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');document.body.append(panel);}
   panel.replaceChildren();panel.dataset.state=stage;
   const confirmed=stage==='confirmed'||stage==='approval_confirmed';
   const terminal=confirmed||stage==='failed';
   const icon=document.createElement('i');icon.className=`ph ${confirmed?'ph-check-circle':stage==='failed'?'ph-warning-circle':'ph-spinner-gap trade-tx-spinner'}`;icon.setAttribute('aria-hidden','true');
   const content=document.createElement('div'),title=document.createElement('strong');title.textContent=tradeStatusLabel(stage,approval,context);
   const row=document.createElement('div');row.className='trade-tx-status__hash';
   const address=document.createElement('button');address.type='button';address.textContent=`${hash.slice(0,12)}…${hash.slice(-10)}`;address.title=hash;address.setAttribute('aria-label','Copy Transaction Hash');
   const shownHash=hash;
   address.onclick=async()=>{try{await navigator.clipboard.writeText(shownHash);address.textContent='Copied';}catch{address.textContent='Could Not Copy';}};
   const view=document.createElement('button');view.type='button';view.className='trade-tx-status__view';view.setAttribute('aria-label','View Transaction');view.title='View Transaction';view.innerHTML='<i class="ph ph-arrow-up-right" aria-hidden="true"></i>';view.onclick=()=>window.open(`${explorer}/tx/${shownHash}`,'_blank','noopener,noreferrer');
   row.append(address,view);content.append(title,row);panel.append(icon,content);
   if(terminal){const close=document.createElement('button');close.type='button';close.className='trade-tx-status__close';close.setAttribute('aria-label','Dismiss Transaction Status');close.textContent='×';close.onclick=dismiss;panel.append(close);dismissTimer=setTimeout(dismiss,30000);}
  },
 };
}
