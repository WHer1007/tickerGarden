import{readFile,writeFile}from'node:fs/promises';import{createPublicClient,http,keccak256,decodeEventLog}from'../apps/web/node_modules/viem/_esm/index.js';
try {
const dir=process.argv[2],outputPath=process.argv[3];if(!dir||!outputPath)throw Error('Usage: prepare-production-runtime.mjs <execution-evidence-directory> <output-json>');const read=async n=>JSON.parse(await readFile(dir+'/'+n,'utf8'));const journal=(await read('.state/deployment-journal.json')).data,plan=await read('activation-plan.json'),runtime=await read('runtime-code.json'),snap=await read('mainnet-snapshot.json');
if(journal.finalVerification?.status!=='DEPLOYED_FINALIZED_STATE_VERIFIED'||journal.steps.length!==34||journal.steps.some(s=>s.status!=='MINED'))throw Error('Deployment is not finalized');
if(!process.env.ROBINHOOD_RPC_URL)throw Error('Missing ROBINHOOD_RPC_URL');
const client=createPublicClient({transport:http(process.env.ROBINHOOD_RPC_URL,{retryCount:1,timeout:20000})});if(await client.getChainId()!==4663)throw Error('wrong chain');const activation=BigInt(journal.finalVerification.activationBlock);const block=await client.getBlock({blockNumber:activation});if(block.hash!==journal.finalVerification.activationBlockHash)throw Error('activation reorg');const genesis=await client.getBlock({blockNumber:0n});const head=await client.getBlock({blockTag:'finalized'});const logs=[];
for(const s of journal.steps){const r=await client.getTransactionReceipt({hash:s.hash});if(r.status!=='success'||r.blockHash!==s.receipt.blockHash)throw Error('receipt mismatch '+s.index);logs.push(...r.logs);}
for(const [module,r]of Object.entries(runtime)){const code=await client.getCode({address:r.address,blockNumber:activation});if(!code||keccak256(code)!==r.codeHash)throw Error('runtime mismatch '+module);}
const normalize=v=>typeof v==='bigint'?v.toString():typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)?v.toLowerCase():Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
const configs=[];const modules={asset:['OfficialStockRegistryV1','asset','AssetRegistered'],quote:['ApprovedQuoteRegistry','getQuoteAssetConfig','QuoteAssetConfigAdded'],baseline:['TickerGardenBaselineRegistry','getTickerGardenBaseline','TickerGardenBaselineAdded'],template:['LaunchTemplateRegistry','getLaunchTemplate','LaunchTemplateAdded']};
for(const [kind,[module,fn,event]]of Object.entries(modules)){
 const abi=(await import('../apps/web/src/v1/generated/contracts/current/'+module+'.ts'))[module];console.log(module,abi.filter(x=>x.type==='function').map(x=>x.name).join(','));
 const ids=kind==='asset'?plan.stakes.map(x=>[x.assetUid,x]):kind==='quote'?plan.quoteConfigs.map(x=>[x.configId,x]):[[kind==='baseline'?plan.baselineId:plan.launchTemplateId,{}]];
 const getters={asset:'asset',quote:'quoteConfig',baseline:'baseline',template:'launchTemplate'};
 const getter=abi.some(x=>x.name===fn)?fn:getters[kind];
 for(let start=0;start<ids.length;start+=4){await Promise.all(ids.slice(start,start+4).map(async([id,meta])=>{
  const value=await client.readContract({address:runtime[module].address,abi,functionName:getter,args:[id],blockNumber:activation});
  const log=logs.find(l=>l.address.toLowerCase()===runtime[module].address.toLowerCase()&&l.topics[1]?.toLowerCase()===id.toLowerCase()&&(()=>{try{return decodeEventLog({abi,data:l.data,topics:l.topics}).eventName===event}catch{return false}})());if(!log)throw Error('no registration receipt '+kind+' '+id);
  const values=normalize(value),status=Number(values.status);delete values.status;if(status!==1)throw Error('inactive '+id);
  if(kind==='asset'){values.tokenSymbol=meta.symbol;values.minimumAllocation=(await client.readContract({address:runtime[module].address,abi,functionName:'minimumAllocation',args:[id],blockNumber:activation})).toString();if(values.stockToken!==meta.tokenAddress.toLowerCase()||values.minimumAllocation!==meta.minimumAllocation)throw Error('asset mismatch');}if(kind==='quote')values.symbol=meta.symbol;
  configs.push({kind,id,status,values,source:{chainId:4663,blockNumber:log.blockNumber.toString(),blockHash:log.blockHash,transactionHash:log.transactionHash,transactionIndex:log.transactionIndex,logIndex:log.logIndex}});
 }));}console.log(kind,ids.length);
}
configs.sort((a,b)=>(a.kind+a.id).localeCompare(b.kind+b.id));const output={schemaVersion:1,chainId:4663,releaseId:plan.releaseId,activationBlock:activation.toString(),activationHash:block.hash,genesisHash:genesis.hash,observedAt:new Date().toISOString(),finalizedHead:head.number.toString(),runtime:normalize(runtime),poolManager:normalize(snap.dependencies.POOL_MANAGER),configs,receiptHashes:journal.steps.map(x=>x.hash)};await writeFile(process.argv[3],JSON.stringify(output,null,2),{flag:'wx',mode:0o600});console.log('verified',configs.length);

}catch(error){console.error('Production runtime preparation failed:',error.shortMessage??error.name);process.exitCode=1;}
