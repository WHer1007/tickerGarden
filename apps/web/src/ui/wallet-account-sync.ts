import type {InjectedProvider} from './wallet-picker.ts';
import {authorizedWalletAccount} from './wallet-session.ts';

/** Invalidate old-account actions immediately; only the latest event may reconnect. */
export function watchWalletAccount(provider:InjectedProvider,chainId:number,actions:{invalidate():void;update(account:string):void;disconnect():void}){
 let generation=0,disposed=false;
 const changed=()=>{
  const version=++generation;
  actions.invalidate();
  void authorizedWalletAccount(provider,chainId).then(account=>{
   if(disposed||version!==generation)return;
   if(account)actions.update(account);else actions.disconnect();
  }).catch(()=>{if(!disposed&&version===generation)actions.disconnect();});
 };
 provider.on?.('accountsChanged',changed);
 provider.on?.('chainChanged',changed);
 return ()=>{disposed=true;generation++;provider.removeListener?.('accountsChanged',changed);provider.removeListener?.('chainChanged',changed);};
}
