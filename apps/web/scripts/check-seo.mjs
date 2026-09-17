import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {PAGE_PATHS} from '../src/routing/routes.ts';
import {pageMetadata} from '../src/routing/metadata.ts';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const indexable=process.env.VERCEL_ENV==='production'&&process.env.VITE_V1_CHAIN_ID==='4663';
const titles=new Set();
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
 for(const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g))assert.ok(fs.existsSync(path.join(root,match[1])),`${route}: missing ${match[1]}`);
}
const home=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(home,/Stake the ticker/);assert.match(home,/194/);
const robots=fs.readFileSync(path.join(root,'robots.txt'),'utf8');const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
assert.equal(robots.includes('Sitemap:'),indexable);assert.equal(sitemap.includes('<loc>'),indexable);
if(!indexable)assert.match(fs.readFileSync(path.join(root,'_headers'),'utf8'),/X-Robots-Tag: noindex/);
console.log(`SEO artifacts verified: ${titles.size} pages; indexing ${indexable?'enabled':'disabled'}.`);
