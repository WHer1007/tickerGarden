import {ApprovedScenarios} from './rpc-approved-scenarios.mjs';
// Read-only RH46630 RPC relay with bounded, resumable observation storage.
// Every stored value is the verbatim upstream result addressed by SHA-256.
// No transaction submission, synthetic headers, receipt promotion, or finality inference.
import fs from 'node:fs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import readline from 'node:readline';
import {fixedRead,readMethods as allowed} from './rpc-cache-policy.mjs';
import {ApprovedStockFunding} from './rpc-approved-stock-funding.mjs';
import {ApprovedAssets} from './rpc-approved-assets.mjs';
import {ApprovedDeployment} from './rpc-approved-deployment.mjs';
import {ProjectScope} from './rpc-project-scope.mjs';
import {RollingCuLimiter,rpcMethodCost} from './rpc-cu-budget.mjs';

const cfg=JSON.parse(process.env.TG_GATEWAY_CONFIG_JSON||fs.readFileSync(process.argv[2],'utf8'));
if(process.env.TG_RPC_CU_PER_SECOND)cfg.cuPerSecond=Number(process.env.TG_RPC_CU_PER_SECOND);
if(!Number.isInteger(cfg.cuPerSecond)||cfg.cuPerSecond<1||cfg.cuPerSecond>10000)throw Error('RPC CU budget outside 1..10000');
if(['upstream','stateUpstream','logUpstream'].some(k=>k in cfg))throw Error('Upstream URLs must be supplied through environment');
if(cfg.chainId!==46630||cfg.host!=='127.0.0.1')throw Error('RH46630 scope mismatch');
if(cfg.prefetch!==false)throw Error('Unscoped prefetch disabled; demand-only mode required');
const deployment=cfg.approvedDeployment?new ApprovedDeployment(cfg.approvedDeployment,cfg.approvedInitialization,cfg.verifiedDeploymentHashes??[]):null;
const scenarios=cfg.approvedScenarios?new ApprovedScenarios(cfg.approvedScenarios):null;
const funding=cfg.approvedStockFunding?new ApprovedStockFunding(cfg.approvedStockFunding.plan,cfg.approvedStockFunding.sha256):null;
const assets=cfg.approvedAssets?new ApprovedAssets(cfg.approvedAssets.plan,cfg.approvedAssets.audit):null;
const scope=new ProjectScope(JSON.parse(fs.readFileSync(cfg.scopeFile)));
const discoveryFile=cfg.discoveryFile;
if(discoveryFile&&fs.existsSync(discoveryFile))scope.restoreDiscoveries(JSON.parse(fs.readFileSync(discoveryFile)));
let discoveryRevision=scope.discoveryRevision;
function persistDiscoveries(){if(discoveryFile&&discoveryRevision!==scope.discoveryRevision){const tmp=discoveryFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...scope.discoveries.values()]),{mode:0o600});fs.renameSync(tmp,discoveryFile);discoveryRevision=scope.discoveryRevision;}}
const budget=new RollingCuLimiter({maxCu:cfg.cuPerSecond??10000});
const publicUrl=process.env.RH46630_RPC_PUBLIC;
const privateUrl=process.env.RH46630_RPC_PRIVATE;
const logsUrl=process.env.RH46630_RPC_LOGS||privateUrl||publicUrl;
for(const [name,url] of [['public',publicUrl],['private',privateUrl],['logs',logsUrl]])if(!url||!/^https:\/\//.test(url))throw Error(`Missing HTTPS ${name} upstream`);
if(cfg.stopAfterBlock!==undefined&&(!Number.isSafeInteger(cfg.stopAfterBlock)||cfg.stopAfterBlock<cfg.startBlock))throw Error('Invalid backfill cap');
const endpoint=method=>method==='eth_getLogs'?logsUrl:['eth_getCode','eth_call','eth_getBalance'].includes(method)?(privateUrl||publicUrl):publicUrl;
const label=method=>method==='eth_getLogs'?'logs':['eth_getCode','eth_call','eth_getBalance'].includes(method)?'private':'public';
fs.mkdirSync(cfg.cacheDir,{recursive:true});const blobDir=cfg.cacheDir+'/values';fs.mkdirSync(blobDir,{recursive:true});
const cache=new Map(),pending=new Map(),hot=new Map(),ledger=cfg.cacheDir+'/responses.jsonl';let sequence=1,finalN=-1,latestN=-1,next=cfg.startBlock;
const stats={upstream:0,hits:0,errors:0,attemptsByMethod:{},cacheHitsByMethod:{}};
const independentPrefix='independent:'+createHash('sha256').update(process.env.RH46630_RPC_INDEPENDENT??'').digest('hex')+':';
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const key=(method,params)=>JSON.stringify(stable([method,params]));
const values=new Map();
if(fs.existsSync(ledger)){const input=fs.createReadStream(ledger),rl=readline.createInterface({input,crlfDelay:Infinity});for await(const line of rl){if(!line)continue;const x=JSON.parse(line);if(!x.digest)throw Error('Digest-backed ledger required');cache.set(x.key,x.digest);}}
function remember(digest,result){values.delete(digest);values.set(digest,result);while(values.size>128)values.delete(values.keys().next().value);return result;}
function cached(k){const digest=cache.get(k);if(values.has(digest))return remember(digest,values.get(digest));const path=blobDir+'/'+digest+'.json',raw=fs.readFileSync(path);if(createHash('sha256').update(raw).digest('hex')!==digest)throw Error('Corrupted RPC observation');return remember(digest,JSON.parse(raw));}
function put(method,params,result,prefix=''){const k=prefix+key(method,params);if(cache.has(k))return;const raw=JSON.stringify(result),digest=createHash('sha256').update(raw).digest('hex'),path=blobDir+'/'+digest+'.json';if(!fs.existsSync(path))fs.writeFileSync(path,raw);remember(digest,result);cache.set(k,digest);fs.appendFileSync(ledger,JSON.stringify({key:k,digest,upstream:prefix?'independent':label(method)})+'\n');}
async function upstream(calls,independent=false){for(let attempt=0;attempt<4;attempt++)try{await budget.acquire(calls.reduce((n,c)=>n+rpcMethodCost(c.method),0));stats.attemptedCU=(stats.attemptedCU??0)+calls.reduce((n,c)=>n+rpcMethodCost(c.method),0);stats.attemptedRequests=(stats.attemptedRequests??0)+calls.length;for(const c of calls)stats.attemptsByMethod[c.method]=(stats.attemptsByMethod[c.method]??0)+1;const batch=calls.map(c=>({...c,jsonrpc:'2.0',id:sequence++})),urls=new Set(calls.map(c=>independent?process.env.RH46630_RPC_INDEPENDENT:endpoint(c.method)));if(urls.size!==1)throw Error('mixed provider batch');const r=await fetch([...urls][0],{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batch),signal:AbortSignal.timeout(cfg.timeoutMs??12000)});if(!r.ok)throw Error('upstream HTTP '+r.status);const out=await r.json();if(!Array.isArray(out)||out.length!==batch.length)throw Error('invalid batch');stats.upstream+=batch.length;const map=new Map(out.map(v=>[v.id,v]));return batch.map(c=>{const v=map.get(c.id);if(v?.error){const error=new Error('RPC '+String(v.error.code));error.rpcError={code:v.error.code,message:String(v.error.message).replace(/https?:\/\/\S+/g,'[endpoint]'),...(typeof v.error.data==='string'&&/^0x[0-9a-f]*$/i.test(v.error.data)?{data:v.error.data}:{})};throw error;}if(!v||!('result' in v)||(v.result==null&&!['eth_getTransactionReceipt','eth_getTransactionByHash'].includes(c.method)))throw Error('upstream unavailable '+c.method);return v.result;});}catch(e){stats.errors++;stats.lastError=e.message;if(e.rpcError||attempt===3)throw e;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}}
async function resolve(method,params,independent=false){const approved=(scenarios&&await scenarios.permits(method,params))||(funding&&await funding.permits(method,params))||(assets&&await assets.permits(method,params))||(deployment&&await deployment.permits(method,params));if(!approved){if(!allowed.has(method))throw Error('read method denied');scope.check(method,params);}if(method==='eth_getBlockByNumber'&&typeof params[0]!=='string')throw Error('block tag must be string');const k=(independent?independentPrefix:'')+key(method,params);if(cache.has(k)){stats.hits++;stats.cacheHitsByMethod[method]=(stats.cacheHitsByMethod[method]??0)+1;const r=cached(k);if(!(approved&&method==='eth_getTransactionReceipt'&&r&&!scope.contracts.has(r.to?.toLowerCase())))scope.observe(method,params,r);persistDiscoveries();return r;}const h=independent?null:hot.get(k);if(h&&Date.now()-h.at<2000){stats.hits++;stats.cacheHitsByMethod[method]=(stats.cacheHitsByMethod[method]??0)+1;return h.result;}if(pending.has(k))return pending.get(k);const p=(async()=>{const [r]=await upstream([{method,params}],independent);if(!(approved&&method==='eth_getTransactionReceipt'&&r&&!scope.contracts.has(r.to?.toLowerCase())))scope.observe(method,params,r);persistDiscoveries();if(!independent&&method==='eth_getBlockByNumber'&&params[1]===false&&/^0x[0-9a-f]{64}$/.test(r.hash??''))put('eth_getBlockByHash',[r.hash,false],r);if(method==='eth_getBlockByNumber'&&params[0]==='finalized')finalN=Number(BigInt(r.number));if(fixedRead(method,params,independent?-1:finalN))put(method,params,r,independent?independentPrefix:'');else if(method==='eth_chainId'||method==='eth_getBlockByNumber')hot.set(k,{result:r,at:Date.now()});return r;})();pending.set(k,p);try{return await p;}finally{pending.delete(k);}}
let active=0;const waiting=[];
async function limited(call,independent){if(active>=(cfg.concurrency??16))await new Promise(r=>waiting.push(r));active++;try{return await resolve(call.method,call.params||[],independent)}finally{active--;waiting.shift()?.()}}
const server=http.createServer(async(req,res)=>{const origin=req.headers.origin;if(origin==='http://127.0.0.1:5178'){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}if(req.method==='OPTIONS'){res.writeHead(origin==='http://127.0.0.1:5178'?204:403);res.end();return;}try{if(req.method==='GET'&&req.url?.startsWith('/market-creation/')){const id=req.url.slice('/market-creation/'.length);if(!/^0x[0-9a-f]{64}$/.test(id)){res.writeHead(400);res.end();return;}const log=[...scope.discoveries.values()].find(l=>l.topics?.[1]===id);res.setHeader('content-type','application/json');res.end(JSON.stringify({transactionHash:log?.transactionHash??null}));return;}if(fs.existsSync(cfg.cacheDir+'/FAIL_RPC'))throw Error('controlled test outage');let body='';for await(const part of req){body+=part;if(body.length>1048576)throw Error('request too large');}const input=JSON.parse(body);const calls=Array.isArray(input)?input:[input];if(calls.length===0||calls.length>256)throw Error('invalid batch size');const answers=await Promise.all(calls.map(async c=>{try{const result=await limited(c,req.url==='/independent');return {jsonrpc:'2.0',id:c.id,result};}catch(error){if(error.rpcError)return{jsonrpc:'2.0',id:c.id,error:error.rpcError};throw error;}}));res.setHeader('content-type','application/json');res.end(JSON.stringify(Array.isArray(input)?answers:answers[0]));}catch(e){res.writeHead(502);res.end('read observation failed');}});

const statusPath=cfg.cacheDir+'/status.json';
server.listen(cfg.port,cfg.host);console.log('RH_READ_CACHE_DEMAND_ONLY_STARTED');
setInterval(()=>fs.writeFileSync(statusPath,JSON.stringify({mode:'demand-only',cuPerSecond:cfg.cuPerSecond??10000,cached:cache.size,stats,at:new Date().toISOString()},null,2)),5000).unref();
