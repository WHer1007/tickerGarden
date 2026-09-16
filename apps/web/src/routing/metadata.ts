import { PAGE_PATHS, type PageName } from "./routes.ts";
export const SITE_ORIGIN="https://tickergarden.com";
export const THEME_COLOR="#f8f7f4";
type Metadata=Readonly<{title:string;description:string;url:string;canonical:string;robots:"index,follow"|"noindex,follow"}>;
const pages:Record<PageName,Pick<Metadata,"title"|"description">>={
 home:{title:"TickerGarden — Grow community signals",description:"TickerGarden is a community interface for exploring markets, creating markets, and reviewing protocol information."},
 markets:{title:"Explore — TickerGarden",description:"Explore TickerGarden markets and review available market information."},
 trade:{title:"Trade a market — TickerGarden",description:"Review a TickerGarden market and its available trading route."},
 create:{title:"Launch a token — TickerGarden",description:"Create a TickerGarden market and review its launch details."},
 stats:{title:"Stats — TickerGarden",description:"Review TickerGarden protocol statistics and available historical information."},
 statsStocks:{title:"Stock stats — TickerGarden",description:"Review available TickerGarden stock statistics and historical information."},
 rewards:{title:"Claim — TickerGarden",description:"Review available TickerGarden claims and reward information."},
 staking:{title:"Stake — TickerGarden",description:"Review TickerGarden staking positions and available staking actions."},
 docs:{title:"Docs — TickerGarden",description:"Read TickerGarden documentation, protocol concepts, and usage information."},
 privacy:{title:"Privacy Policy — TickerGarden",description:"Read the TickerGarden privacy policy."},
 terms:{title:"Terms of Use — TickerGarden",description:"Read the TickerGarden terms of use."},
 "not-found":{title:"Page not found — TickerGarden",description:"The requested TickerGarden page could not be found."}
};
function cleanPath(path="/"){const pathname=path.startsWith("http")?new URL(path).pathname:(path.split(/[?#]/,1)[0]??"/");return pathname.replace(/\/+/g,"/").replace(/\/$/,"")||"/";}
export function pageMetadata(page:PageName,path?:string):Metadata{const pathname=cleanPath(path??(page==="not-found"?"/404":PAGE_PATHS[page]));const canonical=`${SITE_ORIGIN}${pathname}`;return {...pages[page],url:canonical,canonical,robots:page==="not-found"?"noindex,follow":"index,follow"};}
function setMeta(name:string,content:string,attribute="name"){const selector=`meta[${attribute}="${name}"]`;let element=document.head.querySelector<HTMLMetaElement>(selector);if(!element){element=document.createElement("meta");element.setAttribute(attribute,name);document.head.append(element);}element.content=content;}
export function applyPageMetadata(page:PageName,title?:string,path?:string){const metadata=pageMetadata(page,path??window.location.pathname);document.title=title??metadata.title;setMeta("description",metadata.description);setMeta("robots",metadata.robots);setMeta("theme-color",THEME_COLOR);setMeta("og:title",document.title,"property");setMeta("og:description",metadata.description,"property");setMeta("og:site_name","TickerGarden","property");setMeta("og:url",metadata.url,"property");setMeta("twitter:card","summary");setMeta("twitter:title",document.title);setMeta("twitter:description",metadata.description);let link=document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');if(!link){link=document.createElement("link");link.rel="canonical";document.head.append(link);}link.href=metadata.canonical;}
export function renderMetadata(page:PageName,path?:string){const metadata=pageMetadata(page,path);const esc=(value:string)=>value.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");return `<title>${esc(metadata.title)}</title><meta name="description" content="${esc(metadata.description)}"><meta name="robots" content="${metadata.robots}"><meta name="theme-color" content="${THEME_COLOR}"><link rel="canonical" href="${esc(metadata.canonical)}"><meta property="og:title" content="${esc(metadata.title)}"><meta property="og:description" content="${esc(metadata.description)}"><meta property="og:site_name" content="TickerGarden"><meta property="og:url" content="${esc(metadata.url)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(metadata.title)}"><meta name="twitter:description" content="${esc(metadata.description)}">`;}
