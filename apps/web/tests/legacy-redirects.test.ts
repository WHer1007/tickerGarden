import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveRoute} from '../src/routing/routes.ts';
const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
test('server legacy redirects agree with the client and exclude retired pages',()=>{
 const entries=config.redirects as {source:string;destination:string;permanent:boolean}[];
 assert.ok(entries.length>=17);
 for(const entry of entries){assert.equal(resolveRoute(new URL(entry.source,'https://tickergarden.com')).pathname,entry.destination);assert.equal(entry.permanent,true);}
 assert.equal(entries.some(e=>/risks|trade-preview/.test(e.source)),false);
 assert.equal(config.rewrites.some((r:{source:string})=>entries.some(e=>e.source===r.source)),false);
});
