/** Open the current public page, never a transaction/signing URI. */
export function metamaskDappLink(page:string):string|null{
 const url=new URL(page);
 if(url.protocol!=='https:'||url.username||url.password)return null;
 return `https://metamask.app.link/dapp/${url.host}${url.pathname}${url.search}${url.hash}`;
}
