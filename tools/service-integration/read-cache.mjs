// Test-only read relay. Original RPC responses are persisted verbatim.
// No chain time/header/log/receipt synthesis and no transaction submission.
import fs from 'node:fs';
import http from 'node:http';
import {createHash} from 'node:crypto';
const cfg=JSON.parse(fs.readFileSync(process.argv[2]));
if(cfg.chainId!==421614||!cfg.upstream.startsWith('https://')||cfg.host!=='127.0.0.1')throw Error('Test scope mismatch');
if(cfg.stopAfterBlock!==undefined&&(!Number.isSafeInteger(cfg.stopAfterBlock)||cfg.stopAfterBlock<cfg.startBlock))throw Error('Invalid backfill cap');
const endpoint=method=>method==='eth_getLogs'&&cfg.logUpstream?cfg.logUpstream:['eth_getCode','eth_call','eth_getBalance'].includes(method)&&cfg.stateUpstream?cfg.stateUpstream:cfg.upstream;
fs.mkdirSync(cfg.cacheDir,{recursive:true});
const cache=new Map(),pending=new Map(),hot=new Map();let sequence=1,finalN=-1,latestN=-1,next=cfg.startBlock,stats={upstream:0,hits:0,errors:0};
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const key=(method,params)=>JSON.stringify(stable([method,params]));
const values=new Map();
const blobDir=cfg.cacheDir+'/values';fs.mkdirSync(blobDir,{recursive:true});
const ledger=cfg.cacheDir+'/responses.jsonl';
if(fs.existsSync(ledger))for(const line of fs.readFileSync(ledger,'utf8').trim().split('\n').filter(Boolean)){const x=JSON.parse(line);if(!x.digest)throw Error('Digest-backed ledger required');cache.set(x.key,x.digest);}
// Keep only a small working set in memory. The complete immutable observation
// corpus stays on disk, with its content digest checked when loaded.
function remember(digest,result){if(values.has(digest))values.delete(digest);values.set(digest,result);while(values.size>128)values.delete(values.keys().next().value);return result;}
function cached(k){const digest=cache.get(k);if(values.has(digest))return remember(digest,values.get(digest));const raw=fs.readFileSync(blobDir+'/'+digest+'.json');if(createHash('sha256').update(raw).digest('hex')!==digest)throw Error('Corrupted RPC observation');return remember(digest,JSON.parse(raw));}
function put(method,params,result){const k=key(method,params);if(cache.has(k))return;const raw=JSON.stringify(result);const digest=createHash('sha256').update(raw).digest('hex');if(!fs.existsSync(blobDir+'/'+digest+'.json'))fs.writeFileSync(blobDir+'/'+digest+'.json',raw);remember(digest,result);cache.set(k,digest);fs.appendFileSync(ledger,JSON.stringify({key:k,digest,upstream:endpoint(method)})+'\n');}
let turn=Promise.resolve();
async function throttle(n){const wait=turn;turn=turn.then(()=>new Promise(r=>setTimeout(r,Math.max(100,n*(cfg.spacingMs??50)))));await wait;}
async function upstream(calls){
 for(let attempt=0;attempt<4;attempt++){
  try{const liveHeads=calls.every(c=>c.method==='eth_chainId'||(c.method==='eth_getBlockByNumber'&&['latest','finalized'].includes(c.params[0])));if(!liveHeads)await throttle(calls.length);const batch=calls.map(c=>({...c,jsonrpc:'2.0',id:sequence++}));
   const urls=new Set(calls.map(x=>liveHeads&&cfg.stateUpstream?cfg.stateUpstream:endpoint(x.method)));if(urls.size!==1)throw Error('Mixed provider batch');
   const r=await fetch([...urls][0],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batch),signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('upstream HTTP '+r.status);const values=await r.json();if(!Array.isArray(values)||values.length!==batch.length)throw Error('invalid batch');
   stats.upstream+=batch.length;const map=new Map(values.map(v=>[v.id,v]));
   return batch.map(c=>{const v=map.get(c.id);if(!v||v.error||v.result==null)throw Error('upstream unavailable '+c.method+' '+String(v?.error?.message??'missing response').slice(0,240));return v.result;});
  }catch(e){stats.errors++;stats.lastError=e.message;console.error('UPSTREAM_RETRY',e.message);if(attempt===3)throw e;await new Promise(r=>setTimeout(r,5000*(attempt+1)));}
 }
}
async function batches(calls,requestedSize=40){const results=[],size=calls[0]?.method==='eth_getLogs'?2:requestedSize,width=size*4;for(let i=0;i<calls.length;i+=width){const groups=[];for(let j=i;j<Math.min(i+width,calls.length);j+=size)groups.push(upstream(calls.slice(j,Math.min(j+size,calls.length))));results.push(...(await Promise.all(groups)).flat());}return results;}
async function observeHeads(){const [chain,latest,final]=await upstream([{method:'eth_chainId',params:[]},{method:'eth_getBlockByNumber',params:['latest',false]},{method:'eth_getBlockByNumber',params:['finalized',false]}]);if(Number(BigInt(chain))!==cfg.chainId)throw Error('wrong chain');finalN=Number(BigInt(final.number));latestN=Number(BigInt(latest.number));hot.set(key('eth_chainId',[]),{result:chain,at:Date.now()});for(const [tag,result]of [['latest',latest],['finalized',final]])hot.set(key('eth_getBlockByNumber',[tag,false]),{result,at:Date.now()});}
async function resolve(method,params){
 if(!['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getLogs','eth_getTransactionReceipt','eth_getCode','eth_call','eth_getBalance'].includes(method))throw Error('read method denied');
 const k=key(method,params);if(cache.has(k)){stats.hits++;return cached(k);}const h=hot.get(k);if(h&&Date.now()-h.at<2000){stats.hits++;return h.result;}
 if(pending.has(k))return pending.get(k);
 const promise=(async()=>{const [r]=await upstream([{method,params}]);
  if(method==='eth_getBlockByNumber'&&/^0x[0-9a-f]+$/.test(params[0])&&Number(BigInt(r.number))<=finalN)put(method,params,r);
  else if(method==='eth_chainId'||(method==='eth_getBlockByNumber'&&['latest','finalized'].includes(params[0])))hot.set(k,{result:r,at:Date.now()});return r;})();pending.set(k,promise);try{return await promise;}finally{pending.delete(k);}
}
const server=http.createServer(async(req,res)=>{try{if(fs.existsSync(cfg.cacheDir+'/FAIL_RPC')){res.writeHead(503);res.end('controlled test outage');return;}
 let body='';for await(const part of req){body+=part;if(body.length>1048576)throw Error('request too large');}const c=JSON.parse(body);const result=await resolve(c.method,c.params);res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:c.id,result}));
 }catch(e){res.writeHead(502);res.end('read observation failed');}});
const statusPath=cfg.cacheDir+'/status.json';let resumeNext;
if(fs.existsSync(statusPath)){const prior=JSON.parse(fs.readFileSync(statusPath));if(prior.next>cfg.startBlock)resumeNext=prior.next;}
await observeHeads();
if(resumeNext){const [last]=await upstream([{method:'eth_getBlockByNumber',params:['0x'+(resumeNext-1).toString(16),false]}]);if(!cache.has(key('eth_getBlockByHash',[last.hash,false])))throw Error('Resume header changed or incomplete; inspect reorg before continuing');next=resumeNext;}
server.listen(cfg.port,cfg.host);console.log('READ_CACHE_STARTED');
while(true){try{await observeHeads();const end=Math.min(Math.max(finalN,Math.min(cfg.prefetchThrough??finalN,latestN)),next+127,cfg.stopAfterBlock??Number.MAX_SAFE_INTEGER);
 // Re-read provisional number mappings in bounded batches after real finality.
 // These are fresh RPC results, not a promotion of an earlier unfinalized hash.
 const warm=[];for(let n=cfg.startBlock;n<Math.min(next,finalN+1)&&warm.length<128;n++){const tag='0x'+n.toString(16);if(!cache.has(key('eth_getBlockByNumber',[tag,false])))warm.push(tag);}
 if(warm.length){const headers=await batches(warm.map(n=>({method:'eth_getBlockByNumber',params:[n,false]})));for(let i=0;i<headers.length;i++){if(headers[i].number!==warm[i])throw Error('Wrong finalized warm height');put('eth_getBlockByNumber',[warm[i],false],headers[i]);put('eth_getBlockByHash',[headers[i].hash,false],headers[i]);}}
 if(next<=end){const numbers=Array.from({length:end-next+1},(_,i)=>'0x'+(next+i).toString(16));
 const blocks=await batches(numbers.map(n=>({method:'eth_getBlockByNumber',params:[n,false]})));
 // Small complete ranges avoid the provider's per-response log limit on busy
 // blocks. Persist each original response, then group its verbatim logs by hash.
 const logCalls=[];for(let i=0;i<numbers.length;i+=8)logCalls.push({method:'eth_getLogs',params:[{fromBlock:numbers[i],toBlock:numbers[Math.min(i+7,numbers.length-1)]}]});
 const logParts=await batches(logCalls);for(let i=0;i<logParts.length;i++){if(!Array.isArray(logParts[i]))throw Error('Missing range logs');put('eth_getLogs',logCalls[i].params,logParts[i]);}const rangeLogs=logParts.flat();
 const byHash=new Map(blocks.map(b=>[b.hash,[]]));for(const log of rangeLogs){const group=byHash.get(log.blockHash);if(!group||log.removed)throw Error('Range log outside pinned headers');group.push(log);}
 for(const b of blocks)put('eth_getLogs',[{blockHash:b.hash}],byHash.get(b.hash));
 const missing=[];for(const b of blocks){if(!Array.isArray(b.transactions))throw Error('missing txs');
  if(b.transactions.some(tx=>!cache.has(key('eth_getTransactionReceipt',[tx]))))missing.push({method:'eth_getBlockReceipts',params:[b.hash]});}
 const dense=blocks.some(b=>byHash.get(b.hash).length>200);
 const values=await batches(missing,dense?10:40);for(let i=0;i<missing.length;i++){
  const call=missing[i],value=values[i];put(call.method,call.params,value);
  if(call.method==='eth_getBlockReceipts'){
   const b=blocks.find(x=>x.hash===call.params[0]);if(!Array.isArray(value)||value.length!==b.transactions.length)throw Error('Incomplete block receipts');
   for(let j=0;j<value.length;j++){const r=value[j];if(r.blockHash!==b.hash||r.transactionHash!==b.transactions[j]||Number(BigInt(r.transactionIndex))!==j)throw Error('Wrong receipt identity');put('eth_getTransactionReceipt',[r.transactionHash],r);}
  }
 }
 // Ahead-of-finality backfill is bounded to a real observed request block.
 // Never persist a mutable number->hash mapping before finality. The indexer
 // reads that mapping live and still requires the actual finalized RPC tag.
 // Cached receipts are matched to that live header by Go; a reorg fails closed.
 for(let i=0;i<blocks.length;i++){const b=blocks[i];if(b.number!==numbers[i])throw Error('wrong prefetched height');if(Number(BigInt(b.number))<=finalN)put('eth_getBlockByNumber',[b.number,false],b);put('eth_getBlockByHash',[b.hash,false],b);}
 next=end+1;
 }else await new Promise(r=>setTimeout(r,2000));
 fs.writeFileSync(cfg.cacheDir+'/status.json',JSON.stringify({next,finalN,cached:cache.size,stats,at:new Date().toISOString()},null,2));
 }catch(e){console.error('PREFETCH_RETRY',e.message);await new Promise(r=>setTimeout(r,2000));}}
