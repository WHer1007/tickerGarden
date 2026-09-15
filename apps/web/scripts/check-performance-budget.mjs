import fs from 'node:fs';
import {brotliCompressSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=new URL('../dist/',import.meta.url);
const files=fs.readdirSync(new URL('assets/',root));
const budgets=[[/^step-.*\.webp$/,90000],[/^robinhood-feather-60.*\.webp$/,5000],[/^phosphor.*\.woff2$/i,25000]];
for(const name of files){const data=fs.readFileSync(new URL(`assets/${name}`,root));for(const [pattern,limit] of budgets)if(pattern.test(name))assert.ok(data.length<=limit,`${name}: ${data.length} exceeds ${limit}`);if(name.endsWith('.js'))assert.ok(brotliCompressSync(data).length<=220000,`${name}: compressed JS budget exceeded`);}
for(const route of ['docs','privacy','terms','risks']){const html=fs.readFileSync(new URL(`${route}/index.html`,root),'utf8');assert.match(html,/<main id="main-content"/);assert.match(html,/<h1>/);assert.doesNotMatch(html,/<link[^>]+modulepreload[^>]+chain-/);}
console.log('PASS: asset budgets and public document prerender');
const src=new URL('../src/',import.meta.url);const css=fs.readFileSync(new URL('icons/regular.css',src),'utf8');
for(const file of fs.readdirSync(src,{recursive:true})){if(file.startsWith('icons/')||!file.endsWith('.ts'))continue;const text=fs.readFileSync(new URL(file,src),'utf8');const names=[...text.matchAll(/ph-([a-z0-9-]+)/g)].map(m=>m[1]);if(text.includes('ph-${name}'))names.push(...[...text.matchAll(/icon\(['"]([a-z0-9-]+)['"]\)/g)].map(m=>m[1]));for(const name of names)assert.ok(css.includes(`.ph.ph-${name}:before`),`${file}: missing icon ${name}; regenerate subset`);}
console.log('PASS: source icon coverage');
const manifest=JSON.parse(fs.readFileSync(new URL('.vite/manifest.json',root),'utf8'));
const entryKey=Object.keys(manifest).find(key=>manifest[key].name==='app');
const entry=manifest[entryKey];
assert.ok(entry,'business entry missing');
const eager=new Set();
function visit(key){if(eager.has(key))return;eager.add(key);for(const child of manifest[key]?.imports??[])visit(child);}
visit(entryKey);
for(const key of eager){if(key!==entryKey)assert.ok(!(manifest[key].imports??[]).includes(entryKey),'startup dependency imports business entry: '+key);}
for(const key of eager)assert.doesNotMatch(manifest[key].file,/create-controller-|trade-controller-/,'controller entered startup graph');
assert.ok(fs.statSync(new URL(entry.file,root)).size<=500000,'business entry exceeds 500 KB');
for(const file of fs.readdirSync(src,{recursive:true})){
 if(!file.endsWith('.ts')||file.includes('/generated/'))continue;
 const text=fs.readFileSync(new URL(file,src),'utf8');
 assert.doesNotMatch(text,/from\s+['"][^'"]*generated\/(?:abis|current-abis|burn-abis|legacy-abis|legacy-contract-abis)\.(?:ts|js)['"]/,'runtime aggregate ABI import: '+file);
 assert.doesNotMatch(text,/deployments\/manifests\//,'full deployment manifest entered browser: '+file);
}
console.log('PASS: lazy controller graph, ABI import boundaries and business entry budget');
