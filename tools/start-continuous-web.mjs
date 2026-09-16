throw new Error('Archived environment-writing workflow. Use the root .env.test.local and tools/environment.mjs; no per-service configuration may be generated.');
// Isolated testnet UI process; does not write apps/web/.env or change the default release.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
const root=new URL('../',import.meta.url).pathname;
const p=JSON.parse(fs.readFileSync(root+'outputs/reviews/arbitrum-continuous-preflight-2026-09-07/candidate.preview.json'));
const a=p.ordinaryComponents;
const catalog=[{releaseId:p.releaseId,chainId:421614,factory:p.factory,marketRegistry:a[10],hook:p.hook,feeVault:a[15],creatorRegistry:a[11],holderDistributor:a[14],launchRouter:a[9],allocationManager:a[12]}];
const env={VITE_V1_CHAIN_ID:'421614',VITE_V1_READ_API_URL:'http://127.0.0.1:18560',VITE_V1_FACTORY_ADDRESS:p.factory,VITE_V1_LAUNCH_ROUTER_ADDRESS:a[9],VITE_V1_ALLOCATION_MANAGER_ADDRESS:a[12],VITE_V1_PROTOCOL_FEE_VAULT_ADDRESS:a[15],VITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS:a[11],VITE_V1_TREASURY_DISTRIBUTOR_ADDRESS:a[14],VITE_MARKET_RELEASE_CATALOG:JSON.stringify(catalog),VITE_V1_TREASURY_RELEASE_APPROVAL:'',VITE_CONTINUOUS_HOLDER_RELEASE_APPROVAL:''};
fs.writeFileSync(root+'outputs/reviews/continuous-service-2026-09-07/web.public.json',JSON.stringify(env,null,2)+'\n');
const child=spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5195','--strictPort'],{cwd:root+'apps/web',env:{...process.env,...env},stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
