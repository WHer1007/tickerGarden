import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderMetadata} from '../src/routing/metadata.ts';
import {shellMarkup} from '../src/ui/shell.ts';
import {PAGE_PATHS} from '../src/routing/routes.ts';
import home from '../src/pages/home.ts';
import markets from '../src/pages/markets.ts';
import create from '../src/pages/create.ts';
import stats from '../src/pages/stats.ts';
import statsStocks from '../src/pages/statsStocks.ts';
import rewards from '../src/pages/rewards.ts';
import staking from '../src/pages/staking.ts';
import trade from '../src/pages/trade.ts';
import docs from '../src/pages/docs.ts';
import privacy from '../src/pages/privacy.ts';
import terms from '../src/pages/terms.ts';
import {notFound} from '../src/pages/not-found.ts';

export function allowSearchIndex(env){
 return env.VERCEL_ENV==='production' && env.VITE_V1_CHAIN_ID==='4663';
}
const pages={home,markets,create,stats,statsStocks,rewards,staking,trade,docs,privacy,terms,'not-found':notFound};
const styles={trade:['src/pages/tradeReference.css','src/pages/tradeLive.css'],home:'src/home/signal-arbor.css',markets:'src/pages/markets.css',create:'src/create/create.css',stats:'src/pages/stats.css',statsStocks:'src/pages/stats.css',rewards:'src/pages/rewards.css',staking:'src/pages/staking.css',privacy:'legal.css',terms:'legal.css'};
export function prerender(output,env){
 const shell=fs.readFileSync(path.join(output,'index.html'),'utf8');
 const manifest=JSON.parse(fs.readFileSync(path.join(output,'.vite/manifest.json'),'utf8'));
 const indexable=allowSearchIndex(env);
 const base=shell.replace(/<noscript>[\s\S]*?<\/noscript>/g,'').replace(/<title>[\s\S]*?<\/title>/g,'').replace(/<meta\s+(?:name|property)="(?:description|robots|theme-color|og:[^"]+|twitter:[^"]+)"[^>]*>/g,'').replace(/<link\s+rel="canonical"[^>]*>/g,'');
 for(const [name,page] of Object.entries(pages)){
  const route=PAGE_PATHS[name]??'/404';
  const resolveAssets=html=>html.replace(/file:\/\/[^"\s<>]+/g,url=>{
   const source=fileURLToPath(url);const key='assets/'+source.split('/assets/').at(-1);const asset=manifest[key];
   if(asset)return '/'+asset.file;
   // Vite inlines small image assets rather than listing them in the manifest.
   const mime={'.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'}[path.extname(source)];
   const data=fs.readFileSync(source);
   if(!mime||data.length>=4096)throw Error(`Prerender asset missing from manifest: ${key}`);
   return `data:${mime};base64,${data.toString('base64')}`;
  });
  const body=resolveAssets(page.html).replace('<main ','<main id="main-content" ');
  const chrome=shellMarkup(name,'Robinhood Chain');
  const css=[styles[name]??[]].flat().map(source=>`<link rel="stylesheet" href="/${manifest[source].file}">`).join('');
  const html=base.replace('<html ',`<html data-search-index="${indexable?'allow':'deny'}" `).replace(/(<header[^>]*data-shell-header[^>]*>)[\s\S]*?<\/header>/,(_,open)=>open+resolveAssets(chrome.header)+'</header>').replace(/(<footer[^>]*data-shell-footer[^>]*>)[\s\S]*?<\/footer>/,(_,open)=>open+resolveAssets(chrome.footer)+'</footer>').replace('<body',`<body data-page="${name}"`).replace('</head>',`${renderMetadata(name,route,indexable)}${css}</head>`).replace('<div data-route-outlet></div>',`<div data-route-outlet data-prerendered="${name}">${body}</div>`);
  const file=name==='home'?'index.html':name==='not-found'?'404.html':`${route.slice(1)}/index.html`;
  fs.mkdirSync(path.dirname(path.join(output,file)),{recursive:true});fs.writeFileSync(path.join(output,file),html);
  if(name==='trade')fs.writeFileSync(path.join(output,'market-shell.html'),html);
 }
 fs.writeFileSync(path.join(output,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /api/\n${indexable?'Sitemap: https://tickergarden.com/sitemap.xml\n':''}`);
 if(!indexable)fs.writeFileSync(path.join(output,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
}
