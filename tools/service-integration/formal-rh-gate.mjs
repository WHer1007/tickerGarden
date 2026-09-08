import fs from 'node:fs';import {spawn} from 'node:child_process';
const {createPinnedRpcProxy}=await import('../robinhood-rpc-compat-proxy.mjs');
const plan=JSON.parse(fs.readFileSync('deployments/manifests/robinhood-testnet-46630.v1.plan.json'));const pin=plan.forkEvidence;
const proxy=await createPinnedRpcProxy({upstreamUrl:'https://rpc.mainnet.chain.robinhood.com',expectedChainId:'4663',blockNumber:pin.blockNumber,blockHash:pin.blockHash});
try{const child=spawn(process.execPath,['tools/check-v1-ci-tracks.mjs','fork'],{stdio:'inherit',env:{...process.env,ROBINHOOD_RPC_URL:proxy.url}});process.exitCode=await new Promise(resolve=>child.on('exit',resolve));}finally{await proxy.close();}
