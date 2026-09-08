import { LISTING_SUBMISSION_LINKS, serializeListingPackageJSON, serializeListingPackageText, type ListingPackageSnapshot } from './listing-package.ts';
import { ipfsGatewayURL } from './ipfs.ts';

export function renderListingPanel(host: HTMLElement, snapshot: ListingPackageSnapshot, marketId: string, explorer: string, testnet: boolean, gateway?: string): void {
 host.replaceChildren(); host.hidden=false;
 const heading=document.createElement('h2'); heading.textContent='Token created';heading.tabIndex=-1;host.append(heading);
 const summary=document.createElement('p');summary.textContent='Your token information is ready to download and share.';host.append(summary);
 const fields=document.createElement('dl');host.append(fields);
 for(const [label,value] of [['Chain',`${snapshot.chainName} (${snapshot.chainId})`],['Token address',snapshot.tokenAddress],['Name',snapshot.name],['Symbol',snapshot.symbol],['Logo',snapshot.logo],['Website',snapshot.website],['X',snapshot.x],['Metadata',snapshot.metadataURI]]){
  const dt=document.createElement('dt');dt.textContent=label!;const dd=document.createElement('dd');dd.textContent=value||'Not provided';fields.append(dt,dd);
 }
 const actions=document.createElement('div');actions.className='listing-actions';host.append(actions);
 const download=document.createElement('button');download.type='button';download.textContent='Download info pack';actions.append(download);
 download.onclick=()=>{const url=URL.createObjectURL(new Blob([serializeListingPackageJSON(snapshot)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${snapshot.chainId}-${snapshot.tokenAddress}-token-info.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const copy=document.createElement('button');copy.type='button';copy.textContent='Copy details';actions.append(copy);
 const status=document.createElement('p');status.setAttribute('role','status');host.append(status);
 copy.onclick=async()=>{try{await navigator.clipboard.writeText(serializeListingPackageText(snapshot));status.textContent='Details copied.';}catch{status.textContent='Copy unavailable. Download the info pack instead.';}};
 const link=(label:string,url:string)=>{const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);};
 const publicURL=(value:string)=>{const ipfs=ipfsGatewayURL(value,gateway);if(ipfs)return ipfs;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 const metadata=publicURL(snapshot.metadataURI);if(metadata)link('Open metadata',metadata);
 const logo=publicURL(snapshot.logo);if(logo)link('Open logo',logo);
 link('View on explorer',`${explorer}/token/${snapshot.tokenAddress}`);
 const trade=document.createElement('a');trade.textContent='Open market';trade.href=`/trade?marketId=${encodeURIComponent(marketId)}`;actions.append(trade);
 const platforms=document.createElement('h3');platforms.textContent='Platform submissions';host.append(platforms);
 const note=document.createElement('p');note.textContent=testnet?'Testnet token. These are platform guides for a future mainnet listing; testnet support is not assumed.':'Each platform decides chain support and reviews submissions. Nothing has been submitted automatically.';host.append(note);
 const list=document.createElement('ul');host.append(list);
 for(const entry of LISTING_SUBMISSION_LINKS){const li=document.createElement('li');const a=document.createElement('a');a.textContent=`${entry.platform} · ${entry.label}`;a.href=entry.url;a.target='_blank';a.rel='noopener noreferrer';li.append(a);list.append(li);}
 if(snapshot.metadataURI.startsWith('http://')){const local=document.createElement('p');local.textContent='Local development metadata: external platforms cannot access this URL. Configure public publishing before creating a public token.';host.append(local);}
 heading.focus();host.scrollIntoView({block:'start'});
}
