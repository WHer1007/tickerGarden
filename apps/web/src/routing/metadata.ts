import { PAGE_PATHS, type PageName } from "./routes.ts";
export const SITE_ORIGIN="https://tickergarden.com";
export const THEME_COLOR="#f8f7f4";
export const SHARE_IMAGE=Object.freeze({
 url:`${SITE_ORIGIN}/share-meme-stock-launchpad-dark-20261020.jpg`,
 width:1200,
 height:630,
 type:"image/jpeg",
 alt:"TickerGarden — Meme × Stock Launchpad"
});
type Metadata=Readonly<{title:string;description:string;url:string;canonical:string;robots:"index,follow"|"noindex,follow"}>;
const pages:Record<PageName,Pick<Metadata,"title"|"description">>={
 home:{title:"TickerGarden — Token Launches, Markets & Stock Staking",description:"Launch community tokens on Robinhood Chain, explore markets paired with 194 supported Stock Tokens, and stake eligible Stock Tokens to share base trading fees after Bloom."},
 markets:{title:"Explore Community Tokens & Markets — TickerGarden",description:"Browse community-launched tokens and markets on Robinhood Chain, and review market details before trading."},
 trade:{title:"Trade a market — TickerGarden",description:"View a token market on Robinhood Chain, check its current details, and review the available trading route."},
 create:{title:"Launch a Token on Robinhood Chain — TickerGarden",description:"Launch a community token on Robinhood Chain. Choose a paired asset, set LP fees, and configure staking rewards and optional token fee burning."},
 stats:{title:"Protocol Statistics & Market Activity — TickerGarden",description:"Review TickerGarden protocol statistics, market activity, and available historical data."},
 statsStocks:{title:"Stock Token Staking Statistics — TickerGarden",description:"View staking value by Stock Token and compare staking activity across supported assets on TickerGarden."},
 rewards:{title:"Rewards & Claims — TickerGarden",description:"Review available TickerGarden rewards and claims, including claim status and eligibility details."},
 staking:{title:"Stock Staking Rewards — TickerGarden",description:"Stake eligible stock tokens on TickerGarden to earn a share of 30% of base fees after Bloom. Review your position and available staking actions."},
 docs:{title:"TickerGarden Documentation — Markets, Tokens & Staking",description:"Learn how TickerGarden markets, Robinhood Chain token launches, stock staking, rewards, and protocol features work."},
 privacy:{title:"Privacy Policy — TickerGarden",description:"Read how TickerGarden handles information when you use the TickerGarden website and services."},
 terms:{title:"Terms of Use — TickerGarden",description:"Review the terms that apply to using the TickerGarden website and services."},
 "not-found":{title:"Page Not Found — TickerGarden",description:"The requested TickerGarden page could not be found. Explore community tokens, markets, and stock staking from the homepage."}
};
function cleanPath(path="/"){const pathname=path.startsWith("http")?new URL(path).pathname:(path.split(/[?#]/,1)[0]??"/");return pathname.replace(/\/+/g,"/").replace(/\/$/,"")||"/";}
export function pageMetadata(page:PageName,path?:string,indexable=true):Metadata{
 const input=new URL(path??(page==='not-found'?'/404':PAGE_PATHS[page]),SITE_ORIGIN);
 const url=new URL(cleanPath(input.pathname),SITE_ORIGIN),id=page==='trade'?input.searchParams.get('marketId'):null;
 if(id&&/^0x[0-9a-f]{64}$/i.test(id))url.searchParams.set('marketId',id.toLowerCase());
 const chain=input.searchParams.get('chain');
 if(chain==='bsc'||chain==='rh')url.searchParams.set('chain',chain);
 const copy=pages[page],bsc=chain==='bsc';
 const title=bsc?copy.title.replaceAll('Robinhood Chain','BNB Smart Chain'):copy.title;
 const description=bsc?copy.description.replaceAll('Robinhood Chain','BNB Smart Chain').replace('194 supported Stock Tokens','supported bStocks'):copy.description;
 return {title,description,url:url.href,canonical:url.href,robots:!indexable||page==='not-found'?'noindex,follow':'index,follow'};
}
function setMeta(name:string,content:string,attribute="name"){const selector=`meta[${attribute}="${name}"]`;let element=document.head.querySelector<HTMLMetaElement>(selector);if(!element){element=document.createElement("meta");element.setAttribute(attribute,name);document.head.append(element);}element.content=content;}
export function applyPageMetadata(page:PageName,title?:string,path?:string){const metadata=pageMetadata(page,path??window.location.pathname+window.location.search,document.documentElement.dataset.searchIndex==="allow"&&window.location.hostname==="tickergarden.com");document.title=title??metadata.title;setMeta("description",metadata.description);setMeta("robots",metadata.robots);setMeta("theme-color",THEME_COLOR);setMeta("og:title",document.title,"property");setMeta("og:description",metadata.description,"property");setMeta("og:site_name","TickerGarden","property");setMeta("og:url",metadata.url,"property");setMeta("og:type","website","property");setMeta("og:image",SHARE_IMAGE.url,"property");setMeta("og:image:width",String(SHARE_IMAGE.width),"property");setMeta("og:image:height",String(SHARE_IMAGE.height),"property");setMeta("og:image:type",SHARE_IMAGE.type,"property");setMeta("og:image:alt",SHARE_IMAGE.alt,"property");setMeta("twitter:image",SHARE_IMAGE.url);setMeta("twitter:image:alt",SHARE_IMAGE.alt);setMeta("twitter:card","summary_large_image");setMeta("twitter:title",document.title);setMeta("twitter:description",metadata.description);let link=document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');if(!link){link=document.createElement("link");link.rel="canonical";document.head.append(link);}link.href=metadata.canonical;}
export function renderMetadata(page:PageName,path?:string,indexable=true){const metadata=pageMetadata(page,path,indexable);const esc=(value:string)=>value.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");return `<title>${esc(metadata.title)}</title><meta name="description" content="${esc(metadata.description)}"><meta name="robots" content="${metadata.robots}"><meta name="theme-color" content="${THEME_COLOR}"><link rel="canonical" href="${esc(metadata.canonical)}"><meta property="og:title" content="${esc(metadata.title)}"><meta property="og:description" content="${esc(metadata.description)}"><meta property="og:site_name" content="TickerGarden"><meta property="og:url" content="${esc(metadata.url)}"><meta property="og:type" content="website"><meta property="og:image" content="${SHARE_IMAGE.url}"><meta property="og:image:width" content="${SHARE_IMAGE.width}"><meta property="og:image:height" content="${SHARE_IMAGE.height}"><meta property="og:image:type" content="${SHARE_IMAGE.type}"><meta property="og:image:alt" content="${esc(SHARE_IMAGE.alt)}"><meta name="twitter:image" content="${SHARE_IMAGE.url}"><meta name="twitter:image:alt" content="${esc(SHARE_IMAGE.alt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(metadata.title)}"><meta name="twitter:description" content="${esc(metadata.description)}">`;}
