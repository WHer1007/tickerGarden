import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {PAGE_PATHS} from '../src/routing/routes.ts';
import {pageMetadata,SHARE_IMAGE} from '../src/routing/metadata.ts';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const indexable=process.env.VERCEL_ENV==='production'&&process.env.VITE_V1_CHAIN_ID==='4663';
const titles=new Set();
const image=fs.readFileSync(path.join(root,new URL(SHARE_IMAGE.url).pathname));
assert.equal(image.subarray(0,2).toString('hex'),'ffd8','social cover must be a JPEG');
// Read the frame dimensions before the compressed scan data (baseline or progressive JPEG).
let dimensions;
for(let offset=2;offset+9<image.length;){
 assert.equal(image[offset],0xff,'invalid JPEG segment');
 const marker=image[offset+1];
 if(marker===0xda||marker===0xd9)break;
 const length=image.readUInt16BE(offset+2);
 assert.ok(length>=2&&offset+2+length<=image.length,'invalid JPEG segment length');
 if([0xc0,0xc1,0xc2].includes(marker)){
  dimensions={width:image.readUInt16BE(offset+7),height:image.readUInt16BE(offset+5)};break;
 }
 offset+=2+length;
}
assert.deepEqual(dimensions,{width:1200,height:630},'social cover dimensions');
assert.ok(image.length<150_000,'compressed social cover must stay below 150 KB');
for(const [name,route] of Object.entries({...PAGE_PATHS,'not-found':'/404'})){
 const file=name==='home'?'index.html':name==='not-found'?'404.html':`${route.slice(1)}/index.html`;
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const canonical=pageMetadata(name,route).canonical;
 assert.ok(html.includes(`href="${canonical}"`),`${route}: canonical`);
 assert.equal((html.match(/<title>/g)??[]).length,1,`${route}: title count`);
 const title=html.match(/<title>(.*?)<\/title>/)[1];assert.ok(!titles.has(title),'duplicate title');titles.add(title);
 assert.ok(html.includes(`data-prerendered="${name}"`),`${route}: prerender marker`);
 assert.match(html,/<main\s[^>]*id="main-content"/);
 assert.match(html,/<nav aria-label="Primary navigation">/);
 assert.ok(html.includes(`<meta name="robots" content="${indexable&&name!=='not-found'?'index,follow':'noindex,follow'}">`),`${route}: robots`);
 assert.doesNotMatch(html,/file:\/\/|<div data-route-outlet><\/div>/);
 for(const [attribute,name,value] of [['property','og:image',SHARE_IMAGE.url],['name','twitter:image',SHARE_IMAGE.url],['property','og:image:type','image/jpeg'],['name','twitter:card','summary_large_image']]){
  const tags=[...html.matchAll(new RegExp(`<meta ${attribute}="${name}" content="([^"]+)"`,'g'))];
  assert.equal(tags.length,1,`${route}: exactly one ${name}`);assert.equal(tags[0][1],value,`${route}: ${name}`);
 }
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g))assert.ok(fs.existsSync(path.join(root,match[1])),`${route}: missing ${match[1]}`);
}
const home=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(home,/Stake the ticker/);assert.match(home,/194/);
const robots=fs.readFileSync(path.join(root,'robots.txt'),'utf8');const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
assert.equal(robots.includes('Sitemap:'),indexable);assert.equal(sitemap.includes('<loc>'),indexable);
if(!indexable)assert.match(fs.readFileSync(path.join(root,'_headers'),'utf8'),/X-Robots-Tag: noindex/);
console.log(`SEO artifacts verified: ${titles.size} pages; indexing ${indexable?'enabled':'disabled'}.`);
