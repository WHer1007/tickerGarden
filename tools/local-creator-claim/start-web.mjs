import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../..');
const runtime=JSON.parse(fs.readFileSync(path.join(root,'.codex_tmp/local-creator-claim/runtime.json')));
const releaseCatalog=[{
  releaseId:'local-creator-claim-v1',
  holderRewardMode:'wallet-snapshot-v1',
  chainId:runtime.chainId,
  factory:runtime.factory,
  marketRegistry:runtime.marketRegistry,
  hook:runtime.hook,
  feeVault:runtime.feeVault,
  creatorRegistry:runtime.creatorRegistry,
  holderDistributor:runtime.holderDistributor,
  launchRouter:runtime.launchRouter,
  allocationManager:runtime.allocationManager,
}];
const env={
  ...process.env,
  TG_PROFILE:'local-creator-claim',
  VITE_V1_CHAIN_ID:String(runtime.chainId),
  VITE_V1_RPC_URL:runtime.rpc,
  VITE_V1_READ_API_URL:'http://127.0.0.1:8797',
  VITE_INTEGRATION_BOOTSTRAP:`${runtime.bootstrap}?quote=${runtime.quoteId.slice(2)}`,
  VITE_LAUNCH_METADATA_ORIGIN:'http://127.0.0.1:8797',
  VITE_IPFS_GATEWAY:'http://127.0.0.1:8797',
  VITE_V1_FACTORY_ADDRESS:runtime.factory,
  VITE_V1_LAUNCH_ROUTER_ADDRESS:runtime.launchRouter,
  VITE_V1_ALLOCATION_MANAGER_ADDRESS:runtime.allocationManager,
  VITE_V1_PROTOCOL_FEE_VAULT_ADDRESS:runtime.feeVault,
  VITE_V1_CREATOR_REVENUE_REGISTRY_ADDRESS:runtime.creatorRegistry,
  VITE_V1_TREASURY_DISTRIBUTOR_ADDRESS:runtime.holderDistributor,
  VITE_HOLDER_SNAPSHOT_RELEASE_APPROVAL:'HOLDER_WALLET_SNAPSHOT_V1:DEPLOYED_E2E_APPROVED',
  VITE_MARKET_RELEASE_CATALOG:JSON.stringify(releaseCatalog),
};
const vite=path.join(root,'apps/web/node_modules/vite/bin/vite.js');
const child=spawn(process.execPath,[vite,'--host','127.0.0.1','--port',process.env.TG_LOCAL_CREATOR_WEB_PORT||'5179','--strictPort'],{cwd:path.join(root,'apps/web'),env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
