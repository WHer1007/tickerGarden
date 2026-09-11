/** Creator rewards belong to the registered beneficiary for the selected epoch. */
export function ownsCreatorRewards(account:string|undefined,beneficiary:string|undefined):boolean {
 const address=/^0x[0-9a-f]{40}$/i;
 return !!account&&!!beneficiary&&address.test(account)&&address.test(beneficiary)&&!/^0x0{40}$/i.test(account)&&account.toLowerCase()===beneficiary.toLowerCase();
}
