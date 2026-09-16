import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,http} from '../../apps/web/node_modules/viem/_esm/index.js';
export const out=process.argv[2]||'outputs/reviews/rh-mainnet-stock-catalog-2026-09-12';
export const read=n=>JSON.parse(fs.readFileSync(path.join(out,n),'utf8'));
export const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');
process.on('uncaughtException',e=>{console.error('Research RPC operation failed:',e.name);process.exit(1)});
process.on('unhandledRejection',e=>{console.error('Research RPC operation failed:',e?.name||'UnknownError');process.exit(1)});
const env=p=>fs.existsSync(p)?Object.fromEntries(fs.readFileSync(p,'utf8').split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>{let i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]})):{};
const e=env('.env.master.local'),t=env('.env.test.local');
const url=process.env.RH_CATALOG_RPC_URL||e.TG_RPC_URL||`https://robinhood-mainnet.g.alchemy.com/v2/${e.ALCHEMY_API_KEY||t.ALCHEMY_API_KEY}`;
export const c=createPublicClient({transport:http(url,{retryCount:1,timeout:25000,batch:{batchSize:40,wait:20}})});
if(await c.getChainId()!==4663)throw new Error('Wrong chain');
export const bn=BigInt(read('raw/chain-snapshot.json').number);
export async function chunks(rows,fn,size=8){const result=[];for(let i=0;i<rows.length;i+=size){result.push(...await Promise.all(rows.slice(i,i+size).map(fn)));if(i%60===0)console.log('processed',Math.min(i+size,rows.length),'/',rows.length);}return result;}
