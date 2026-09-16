import fs from 'node:fs';
import { keccak_256 } from '../deployments/node_modules/@noble/hashes/sha3.js';
const address=process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(address??'') || /^0x0{40}$/.test(address)) throw Error('Provide a nonzero public test operator address');
const plan=JSON.parse(fs.readFileSync(new URL('../deployments/manifests/arbitrum-sepolia-421614.v1.plan.json',import.meta.url)));
const rpcUrl=process.env.ARBITRUM_SEPOLIA_RPC_URL || plan.chain.rpcUrl;
const rpc=async(method,params)=>{const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(j.error)throw Error(`RPC ${method} failed`);return j.result;};
if(BigInt(await rpc('eth_chainId',[]))!==421614n)throw Error('Only Arbitrum Sepolia is permitted');
const block=await rpc('eth_getBlockByNumber',['latest',false]);
const [balance,nonce,code]=await Promise.all(['eth_getBalance','eth_getTransactionCount','eth_getCode'].map(method=>rpc(method,[address,block.number])));
if(code!=='0x')throw Error('This profile requires the dedicated test EOA');
const hash=text=>'0x'+Buffer.from(keccak_256(Buffer.from(text))).toString('hex');
const codehash=BigInt(balance)>0n||BigInt(nonce)>0n?hash(''):'0x'+'0'.repeat(64);
const values={V1_TESTNET_TARGET:'arbitrum-sepolia',ARBITRUM_SEPOLIA_RPC_URL:rpcUrl,V1_EXPECTED_CHAIN_ID:'421614',V1_EXPECTED_DEPLOYER:address,V1_INITIAL_ADMIN:address,V1_PLATFORM_TREASURY:address,V1_ROOT_SERVICE_TREASURY:address,V1_PLATFORM_TREASURY_CODEHASH:codehash,V1_RELEASE_ID:hash('TICKERGARDEN_ARB_SEPOLIA_PUBLIC_TEST_2026_09_06_'+address.toLowerCase()),V1_ROOT_SERVICE_FEE_ASSET:'0x'+'0'.repeat(40),V1_ROOT_SERVICE_FEE_AMOUNT:'1000000000000000',V1_FINALITY_DELAY_SECONDS:'600',V1_FINALITY_DELAY_BLOCKS:'2',V1_ROOT_PUBLICATION_WINDOW:'86400',V1_ROOT_REVIEW_DELAY:'3600',V1_CLAIM_WINDOW:'2592000',V1_FEE_POLICY_ID:hash('TICKERGARDEN_V1_FEE_POLICY_40_30_30')};
const existingEnvPath=new URL('../deployments/config/arbitrum-sepolia.public.env',import.meta.url);
if(fs.existsSync(existingEnvPath)) {
 const existing=fs.readFileSync(existingEnvPath,'utf8');
 const previousDeployer=existing.match(/^V1_EXPECTED_DEPLOYER=(.*)$/m)?.[1];
 const previousRelease=existing.match(/^V1_RELEASE_ID=(0x[0-9a-fA-F]{64})$/m)?.[1];
 if(previousDeployer?.toLowerCase()===address.toLowerCase()&&previousRelease)values.V1_RELEASE_ID=previousRelease;
}
const treasuryPath=new URL('../deployments/manifests/arbitrum-sepolia-421614.test-treasury.json',import.meta.url);
if(!fs.existsSync(treasuryPath))throw Error('Deploy and verify the test treasury receiver before preparing the core deployment');
const treasury=JSON.parse(fs.readFileSync(treasuryPath));
if(treasury.status!=='DEPLOYED_VERIFIED'||treasury.owner.toLowerCase()!==address.toLowerCase())throw Error('Treasury owner mismatch');
const treasuryCode=await rpc('eth_getCode',[treasury.address,'latest']);
const treasuryHash='0x'+Buffer.from(keccak_256(Buffer.from(treasuryCode.slice(2),'hex'))).toString('hex');
if(treasuryCode==='0x'||treasuryHash!==treasury.runtimeCodeHash)throw Error('Treasury code drift');
values.V1_PLATFORM_TREASURY=treasury.address;
values.V1_PLATFORM_TREASURY_CODEHASH=treasuryHash;
for(const dep of plan.externalDependencies){const n=({UNIVERSAL_ROUTER:'SWAP_ROUTER',V4_QUOTER:'QUOTER'})[dep.name]??dep.name;if(['POOL_MANAGER','POSITION_MANAGER','PERMIT2','SWAP_ROUTER','QUOTER'].includes(n)){values['V1_'+n]=dep.address;values['V1_'+n+'_CODEHASH']=dep.runtimeCodeHash;}}
const root=new URL('../',import.meta.url);
fs.writeFileSync(new URL('deployments/config/arbitrum-sepolia.public.env',root),'# Public values only. Re-run after funding before deployment; contains no private key.\n'+Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n')+'\n');
const report={chainId:421614,address,balanceWei:BigInt(balance).toString(),nonce:BigInt(nonce).toString(),blockNumber:BigInt(block.number).toString(),blockHash:block.hash,releaseId:values.V1_RELEASE_ID,status:BigInt(balance)===0n?'AWAITING_TEST_ETH':'FUNDED_NOT_BROADCAST',broadcastPerformed:false,observedAt:new Date().toISOString()};
fs.mkdirSync(new URL('outputs/reviews/arbitrum-wallet-deployment/',root),{recursive:true});
fs.writeFileSync(new URL('outputs/reviews/arbitrum-wallet-deployment/operator.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
