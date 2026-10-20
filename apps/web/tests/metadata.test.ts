import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { pageMetadata, renderMetadata, SHARE_IMAGE } from "../src/routing/metadata.ts";
import { PAGE_PATHS } from "../src/routing/routes.ts";
test("metadata strips query and hash from canonical URLs",()=>{const metadata=pageMetadata("trade","/trade?marketId=abc#details");assert.equal(metadata.canonical,"https://tickergarden.com/trade");assert.equal(metadata.robots,"index,follow");});
test("not-found is noindex and valid routes are indexable",()=>{assert.equal(pageMetadata("not-found","/missing?x=1").robots,"noindex,follow");assert.equal(pageMetadata("statsStocks","/stats/stocks").robots,"index,follow");});
test("source HTML and every rendered route use the same large social cover",()=>{
 const sources=[fs.readFileSync(new URL("../index.html",import.meta.url),"utf8"),...Object.keys(PAGE_PATHS).map(name=>renderMetadata(name as keyof typeof PAGE_PATHS)),renderMetadata("not-found")];
 for(const html of sources){
  for(const [attribute,name,value] of [
   ["property","og:image",SHARE_IMAGE.url],["name","twitter:image",SHARE_IMAGE.url],
   ["property","og:image:width","1200"],["property","og:image:height","630"],
   ["property","og:image:type","image/jpeg"],["property","og:image:alt",SHARE_IMAGE.alt],
   ["name","twitter:image:alt",SHARE_IMAGE.alt],["name","twitter:card","summary_large_image"]
  ]){
   const tags=[...html.matchAll(new RegExp(`<meta ${attribute}="${name}" content="([^"]+)"`,"g"))];
   assert.equal(tags.length,1,`${name}: exactly one tag`);assert.equal(tags[0]?.[1],value,name);
  }
  assert.doesNotMatch(html,/\/share\.png/);
 }
});

test('preview metadata cannot advertise indexable routes',()=>{
 for(const page of ['home','markets','create','stats','rewards','staking','docs','trade'] as const){
  assert.equal(pageMetadata(page,undefined,false).robots,'noindex,follow');
  assert.match(renderMetadata(page,undefined,false),/<meta name="robots" content="noindex,follow">/);
 }
});
test('public routes have independent descriptive titles and canonical URLs',()=>{
 const names=['home','markets','create','stats','statsStocks','rewards','staking','docs','privacy','terms'] as const;
 const metadata=names.map(name=>pageMetadata(name));
 assert.equal(new Set(metadata.map(page=>page.title)).size,names.length);
 assert.equal(new Set(metadata.map(page=>page.canonical)).size,names.length);
 for(const page of metadata){assert.ok(page.description.length>50);assert.ok(page.title.includes('TickerGarden'));}
});

test('client navigation preserves the environment indexing restriction',async()=>{
 const {applyPageMetadata}=await import('../src/routing/metadata.ts');
 const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 try{
  for(const [policy,hostname,expected] of [['deny','tickergarden.com','noindex,follow'],['allow','preview.vercel.app','noindex,follow'],['allow','tickergarden.com','index,follow']]){
   const nodes=new Map<string,{content?:string;href?:string}>();
   const doc={title:'',documentElement:{dataset:{searchIndex:policy}},head:{querySelector(selector:string){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}}};
   Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
   Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{hostname,pathname:'/explore',search:''}}});
   applyPageMetadata('markets');applyPageMetadata('docs',undefined,'/docs');
   assert.equal(nodes.get('meta[name="robots"]')?.content,expected);
   assert.equal(doc.title,pageMetadata('docs').title);
   assert.equal(nodes.get('link[rel="canonical"]')?.href,'https://tickergarden.com/docs');
   assert.equal(nodes.get('meta[property="og:image"]')?.content,SHARE_IMAGE.url);
   assert.equal(nodes.get('meta[name="twitter:image"]')?.content,SHARE_IMAGE.url);
   assert.equal(nodes.get('meta[name="twitter:card"]')?.content,'summary_large_image');
   assert.equal(nodes.get('meta[property="og:image:width"]')?.content,'1200');
   assert.equal(nodes.get('meta[property="og:image:height"]')?.content,'630');
   assert.equal(nodes.get('meta[name="twitter:image:alt"]')?.content,SHARE_IMAGE.alt);
  }
 }finally{
  if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');
  if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');
 }
});
