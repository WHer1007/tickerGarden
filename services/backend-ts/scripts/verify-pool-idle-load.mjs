import fs from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
// Closed-loop comparison, not a capacity benchmark. Only RH testnet is accepted.
const [manifest,output]=process.argv.slice(2);
if(!manifest||!output)throw Error('usage: node verify-pool-idle-load.mjs <targets.json> <output-directory>');
const directory=pathToFileURL(path.resolve(output)+path.sep);
const targets=JSON.parse(fs.readFileSync(manifest));
if(!Array.isArray(targets)||targets.length<1||targets.length>4)throw Error('One to four test deployments are required');
for(const target of targets){
 const url=new URL(target.url);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.vercel.app')||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Only plain HTTPS Vercel preview origins are accepted');
 if(![1000,3000,5000,10000].includes(target.idleMs))throw Error('Expected 1s, 3s, 5s or 10s parameters');
}
if(new Set(targets.map(t=>t.url)).size!==targets.length||new Set(targets.map(t=>t.idleMs)).size!==targets.length||new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('Targets must be distinct');
fs.mkdirSync(directory,{recursive:true});
const rows=[];
const began=new Date().toISOString();
const file=new URL('requests.json',directory);
if(fs.existsSync(file))throw Error('Refusing to overwrite an existing load run');
const save=()=>{const temp=new URL('requests.tmp',directory);fs.writeFileSync(temp,JSON.stringify({began,updated:new Date().toISOString(),rows},null,2));fs.renameSync(temp,file);};
for(const target of targets){
 const health=await fetch(target.url+'/health',{signal:AbortSignal.timeout(15000)}).then(r=>r.json());
 if(health.sync?.chainId!==46630)throw Error('Not verified test chain: '+target.id);
}
let issued=0;
async function request(target,round,phase){
 if(issued>=1200)throw Error('Request budget exhausted');
 issued++;
 const started=performance.now(),at=new Date().toISOString();
 let row;
 try{
  const response=await fetch(target.url+'/v1/explore?limit=2&sort=marketCapUsd_desc',{signal:AbortSignal.timeout(12000)});
  const ttfbMs=performance.now()-started;
  const body=await response.json();
  row={id:target.id,idleMs:target.idleMs,round,phase,at,status:response.status,ttfbMs,ms:performance.now()-started,requestId:response.headers.get('x-vercel-id'),cache:response.headers.get('x-vercel-cache'),valid:Array.isArray(body.items)};
 }catch(error){row={id:target.id,round,phase,at,status:0,ms:performance.now()-started,error:String(error)};}
 rows.push(row);save();
 if(row.status!==200||!row.valid)throw Error('Load stopped on error: '+JSON.stringify(row));
}
// Reverse order on the second pass to reduce ordering bias. Never overlap arms.
for(let round=0;round<2;round++){
 for(const target of round===0?targets:[...targets].reverse()){
  for(const [phase,duration,gap,concurrency] of [['steady',45000,500,1],['sparse',45000,2000,1],['burst',30000,3000,4]]){
   const start=performance.now();
   while(performance.now()-start<duration){await Promise.all(Array.from({length:concurrency},()=>request(target,round,phase)));await sleep(gap);}
   const group=rows.filter(r=>r.id===target.id&&r.round===round&&r.phase===phase);
   console.log(JSON.stringify({id:target.id,round,phase,count:group.length,elapsedMs:performance.now()-start}));
  }
 }
}
save();console.log('COMPLETED');
