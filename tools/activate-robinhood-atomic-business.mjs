throw new Error('Archived environment-writing workflow. Use the root .env.test.local and tools/environment.mjs; no per-service configuration may be generated.');
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPublicClient,defineChain,http,keccak256} from '../apps/web/node_modules/viem/_esm/index.js';
const releaseId=process.env.TG_RH_RELEASE_ID;
if(!/^0x[0-9a-f]{64}$/.test(releaseId??''))throw Error('Specify reviewed TG_RH_RELEASE_ID');
const dir=`deployments/releases/${releaseId}`,read=p=>JSON.parse(fs.readFileSync(p));
const report=read(`${dir}/atomic-buy-public-test.json`),deployment=read(`${dir}/robinhood-testnet-46630.v1.deployed.json`);
const required=['zero-TSLA','zero-AMZN','zero-PLTR','zero-NFLX','zero-AMD','partial-TSLA','direct-TSLA','native-ETH','revert-max-eth','revert-min-output'];
const ensure=(ok,msg)=>{if(!ok)throw Error(msg)};
ensure(report.status==='PUBLIC_TESTNET_ATOMIC_BUY_PASSED'&&report.releaseId===releaseId&&report.chainId===46630,'Public test gate not passed');
ensure(required.every(id=>report.cases.some(x=>x.id===id&&x.status==='PASSED')),'Public test coverage incomplete');
ensure(deployment.status==='DEPLOYED_VERIFIED_ACTIVE_TEST_ONLY'&&deployment.operatorConfigured,'Deployment/settlement gate not passed');
const parse=p=>Object.fromEntries(fs.readFileSync(p,'utf8').split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]}));
const env=parse('.env'),rpc=`https://robinhood-testnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
const chain=defineChain({id:46630,name:'Robinhood Testnet',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const client=createPublicClient({chain,transport:http(rpc,{timeout:20000})});
try {
ensure(await client.getChainId()===46630,'Wrong chain');
for(const c of deployment.contracts.filter(x=>['LaunchAndBuyRouter','TickerGardenFactoryV1'].includes(x.name)))ensure(keccak256(await client.getCode({address:c.address}))===c.runtimeCodeHash,'Deployed code drift');
for(const row of report.cases){const r=await client.getTransactionReceipt({hash:row.txHash});const b=await client.getBlock({blockNumber:r.blockNumber});ensure(b.hash===r.blockHash&&r.status===(row.id.startsWith('revert-')?'reverted':'success'),'Public test receipt drift');}
const backup=`${dir}/pre-business-activation`;fs.mkdirSync(backup,{recursive:true,mode:0o700});
const snapshot=p=>{const base=p.includes('.env')?`/Users/dear/.config/tickergarden/backups/${releaseId}`:backup;fs.mkdirSync(base,{recursive:true,mode:0o700});const target=`${base}/${p.replaceAll('/','__')}`;if(fs.existsSync(p)&&!fs.existsSync(target)){fs.copyFileSync(p,target);fs.chmodSync(target,0o600)}};
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const paired=read(`${dir}/paired-assets.json`),stocks=read(`${dir}/stock-assets.json`);
for(const a of paired.assets)if(a.assetKind==='OFFICIAL_STOCK'){a.nativeQuotePoolFee=10000;a.nativeQuoteTickSpacing=200;}
write(`${dir}/paired-assets.json`,paired);
for(const [p,value] of [['deployments/manifests/robinhood-testnet-46630.paired-assets.json',paired],['deployments/manifests/robinhood-testnet-46630.stock-assets.json',stocks]]){snapshot(p);write(p,value);}
const components=Object.fromEntries(deployment.contracts.map(x=>[x.name,x.address.toLowerCase()]));
const frontendPath='apps/web/.env.local',frontend=parse(frontendPath);
const catalog=JSON.parse(frontend.VITE_MARKET_RELEASE_CATALOG??'[]').filter(x=>x.factory.toLowerCase()!==deployment.factory.toLowerCase());
catalog.push({releaseId,chainId:46630,factory:deployment.factory.toLowerCase(),marketRegistry:components.MarketRegistryV1,hook:deployment.hook.toLowerCase(),feeVault:components.ProtocolFeeVault,creatorRegistry:components.CreatorRevenueRegistry,holderDistributor:components.HolderRewardsDistributorV1,launchRouter:components.LaunchAndBuyRouter,allocationManager:components.AllocationManager});
const edits={VITE_V1_CHAIN_ID:'46630',VITE_V1_FACTORY_ADDRESS:deployment.factory.toLowerCase(),VITE_V1_LAUNCH_ROUTER_ADDRESS:components.LaunchAndBuyRouter,VITE_V1_ALLOCATION_MANAGER_ADDRESS:components.AllocationManager,VITE_V1_PROTOCOL_FEE_VAULT_ADDRESS:components.ProtocolFeeVault,VITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS:components.CreatorRevenueRegistry,VITE_V1_TREASURY_DISTRIBUTOR_ADDRESS:components.HolderRewardsDistributorV1,VITE_MARKET_RELEASE_CATALOG:JSON.stringify(catalog)};
// Preserve unrelated settings, comments and public API origins.
function updateEnv(p,values){snapshot(p);let text=fs.readFileSync(p,'utf8');for(const [k,v] of Object.entries(values)){const re=new RegExp(`^${k}=.*$`,'m');text=re.test(text)?text.replace(re,()=>`${k}=${v}`):`${text}\n${k}=${v}\n`;}fs.writeFileSync(p,text,{mode:0o600});fs.chmodSync(p,0o600)}
updateEnv(frontendPath,edits);
const backendPath='services/backend-go/.env',backend=parse(backendPath);
const old=read(backend.TG_DEPLOYMENT_MANIFEST),supported=new Set(old.contracts.map(x=>x.module));
const contracts=[...old.contracts];for(const c of deployment.contracts)if(supported.has(c.name)&&!contracts.some(x=>x.address.toLowerCase()===c.address.toLowerCase()))contracts.push({module:c.name,address:c.address.toLowerCase(),runtimeCodeHash:c.runtimeCodeHash});
const manifestPath=path.resolve(`${dir}/backend-deployment-manifest.json`);write(manifestPath,{...old,contracts});
updateEnv(backendPath,{TG_DEPLOYMENT_MANIFEST:manifestPath,TG_ANALYTICS_MANIFEST:manifestPath,TG_TRANSACTION_STATUS_MANIFEST:manifestPath});
let readApi='NOT_CHECKED';try{const response=await fetch(`${frontend.VITE_V1_READ_API_URL}/health`,{signal:AbortSignal.timeout(5000)});const health=await response.json();readApi=health.sync?.status??'unavailable'}catch{readApi='unavailable'}
const marker={status:'ACTIVE_TEST_BUSINESS_ATOMIC_BUY_VERIFIED',chainId:46630,releaseId,productionStatus:'NOT_PRODUCTION_READY',publicAtomicBuyTests:'PASSED',testReportSha256:createHash('sha256').update(fs.readFileSync(`${dir}/atomic-buy-public-test.json`)).digest('hex'),activatedAt:new Date().toISOString(),factory:deployment.factory,router:components.LaunchAndBuyRouter,frontendConfiguration:'UPDATED',backendConfiguration:'UPDATED_REQUIRES_SERVICE_RELOAD',readApiStatus:readApi,scope:'Public-chain atomic first-buy only; not full frontend or holder-settlement E2E'};
write(`${dir}/business-activation.json`,marker);
write(`${dir}/release-status.json`,{...read(`${dir}/release-status.json`),atomicFirstBuyPublicTest:'PASSED',businessActivation:'business-activation.json'});
console.log(JSON.stringify(marker));
}catch(e){console.error(String(e.shortMessage??e.message).split(rpc).join('[RPC]').slice(0,500));process.exitCode=1}
