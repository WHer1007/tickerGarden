import { LISTING_SUBMISSION_LINKS, serializeListingPackageJSON, serializeListingPackageText, type ListingPackageSnapshot } from './listing-package.ts';
import { ipfsGatewayURL } from './ipfs.ts';

export function renderListingPanel(host: HTMLElement, snapshot: ListingPackageSnapshot, marketId: string, explorer: string, testnet: boolean, gateway?: string, navigate?: (url:string)=>void): void {
 host.replaceChildren();host.hidden=false;
 const icon=(name:string)=>{const i=document.createElement('i');i.className=`ph ${name}`;i.setAttribute('aria-hidden','true');return i;};
 const button=(label:string,glyph:string,action:()=>void)=>{const b=document.createElement('button');b.type='button';b.append(icon(glyph),document.createTextNode(label));b.onclick=action;return b;};
 const publicURL=(value:string)=>{const ipfs=ipfsGatewayURL(value,gateway);if(ipfs)return ipfs;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 const external=(label:string,url:string,glyph='ph-arrow-up-right')=>button(label,glyph,()=>{window.open(url,'_blank','noopener,noreferrer');});
 const header=document.createElement('header');header.className='listing-success-heading';
 const mark=document.createElement('span');mark.className='listing-success-mark';mark.append(icon('ph-check'));
 const heading=document.createElement('h1');heading.textContent='Token Created';heading.tabIndex=-1;
 const note=document.createElement('p');note.textContent='Your token is live.';header.append(mark,heading,note);host.append(header);
 const identity=document.createElement('div');identity.className='listing-token-identity';
 const image=document.createElement('img');image.alt='';image.src=publicURL(snapshot.logo)??new URL('../../assets/token-placeholder.svg',import.meta.url).href;
 image.onerror=()=>{image.onerror=null;image.src=new URL('../../assets/token-placeholder.svg',import.meta.url).href;};
 const name=document.createElement('strong');name.textContent=snapshot.name;
 const symbol=document.createElement('span');symbol.textContent=snapshot.symbol;
 const names=document.createElement('div');names.append(name,symbol);
 const chain=document.createElement('span');chain.className='listing-chain';chain.textContent=snapshot.chainName;
 identity.append(image,names,chain);host.append(identity);
 const status=document.createElement('p');status.className='listing-copy-status';status.setAttribute('role','status');
 const copy=async(value:string,message:string)=>{try{await navigator.clipboard.writeText(value);status.textContent=message;}catch{status.textContent='Unable To Copy. Download The Info Pack.';}};
 const address=document.createElement('div');address.className='listing-token-address';
 const label=document.createElement('span');label.textContent='Contract';const value=document.createElement('code');value.textContent=snapshot.tokenAddress;
 const copyAddress=button('','ph-copy',()=>{void copy(snapshot.tokenAddress,'Address Copied');});copyAddress.setAttribute('aria-label','Copy token address');copyAddress.title='Copy Address';
 address.append(label,value,copyAddress);host.append(address);
 const primary=document.createElement('div');primary.className='listing-primary-actions';
 const view=button('View Token','ph-arrow-up-right',()=>{const url=`/trade?marketId=${encodeURIComponent(marketId)}`;if(navigate)navigate(url);else window.location.assign(url);});view.className='listing-view-token';
 primary.append(view,external('View On Explorer',`${explorer}/token/${snapshot.tokenAddress}`));host.append(primary);
 const pack=document.createElement('section');pack.className='listing-info-pack';
 const packHeading=document.createElement('h2');packHeading.textContent='Token Info Pack';
 const summary=document.createElement('p');summary.textContent='Token details, logo and social links in one file.';
 const actions=document.createElement('div');actions.className='listing-actions';
 actions.append(button('Download','ph-download-simple',()=>{const url=URL.createObjectURL(new Blob([serializeListingPackageJSON(snapshot)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${snapshot.chainId}-${snapshot.tokenAddress}-token-info.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}),button('Copy Details','ph-copy',()=>{void copy(serializeListingPackageText(snapshot),'Details Copied');}));
 pack.append(packHeading,summary,actions);host.append(pack);
 const links=document.createElement('div');links.className='listing-resource-links';
 for(const [label,value] of [['Website',snapshot.website],['X',snapshot.x],['Metadata',snapshot.metadataURI],['Logo',snapshot.logo]]){const url=publicURL(value!);if(url){const entry=external(label!,url);entry.title=url;links.append(entry);}}
 if(links.childElementCount)host.append(links);
 const platforms=document.createElement('details');platforms.className='listing-platforms';const title=document.createElement('summary');title.append(document.createTextNode('Platform Submissions'),icon('ph-caret-down'));platforms.append(title);
 const explanation=document.createElement('p');explanation.textContent=testnet?'Testnet token. Check platform support before submitting.':'Submit your info pack directly to each platform.';platforms.append(explanation);
 const list=document.createElement('div');list.className='listing-platform-links';for(const entry of LISTING_SUBMISSION_LINKS)list.append(external(entry.platform,entry.url));platforms.append(list);host.append(platforms,status);
 heading.focus();host.scrollIntoView({block:'start'});
}
