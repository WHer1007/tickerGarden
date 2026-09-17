export type MarketSettings = {burnMemeFees?:boolean;lpFeePips?:number;launchPhase?:number};
export function marketSettingsDisplay(market:MarketSettings|null){
 const fee=market?.lpFeePips;
 return {burnEnabled:market?.burnMemeFees===true,
  fee:fee!==undefined&&[0,1000,2000,3000].includes(fee)?`${fee/10000}%`:'-'};
}
export function renderMarketSettings(root:ParentNode,market:MarketSettings|null){
 const value=marketSettingsDisplay(market);
 const fee=root.querySelector('[data-detail-lp-setting]');if(fee)fee.textContent=value.fee;
 const badge=root.querySelector<HTMLElement>('[data-detail-burn-setting]');if(badge)badge.hidden=!value.burnEnabled;
}
