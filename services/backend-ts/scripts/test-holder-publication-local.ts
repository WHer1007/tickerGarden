/** Dedicated localhost fixture test, NOT a production preflight or deployment adapter. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {createPublicClient,http,encodeFunctionData,parseAbi,type Abi,type Address,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {PublicationRpcTransport} from '../packages/chain-worker/src/holder-publication-rpc.ts';
import {buildSnapshot} from '../packages/chain/src/holder-snapshot.ts';
import {snapshotAbis} from '../packages/events/src/f72-abis.generated.ts';
import {CURRENT_RELEASE_ID} from '../packages/events/src/index.ts';
import {publishSnapshotOnce,reconcilePublication,type PublicationDependencies,type PublicationJournal} from '../packages/chain-worker/src/holder-publication.ts';
import {withPublicationJournal} from '../packages/chain-worker/src/holder-publication-journal.ts';

const dir=path.resolve('.codex_tmp/holder-publication'),url='http://127.0.0.1:18677';
const rpc=new PublicationRpcTransport({url}),second=new PublicationRpcTransport({url});
// Test-only administration, fixed localhost URL; production transports do not allow these methods.
async function admin<T=unknown>(method:string,params:unknown[]=[]):Promise<T>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const body=await response.json() as {result:T;error?:unknown};if(body.error)throw Error('Local Anvil fixture setup failed');return body.result;}
assert.equal(await rpc.call('eth_chainId',[]),'0xb626');assert.match(await admin<string>('web3_clientVersion'),/anvil/i);
const alloc=JSON.parse(fs.readFileSync(dir+'/alloc.json','utf8')) as Record<Address,{code?:Hex;balance?:Hex;storage?:Record<Hex,Hex>}>;
for(const [raw,a]of Object.entries(alloc)){
 const address=raw as Address;
 if(a.code)await admin('anvil_setCode',[address,a.code]);
 if(a.balance)await admin('anvil_setBalance',[address,a.balance]);
 for(const [slot,value]of Object.entries(a.storage??{}))await admin('anvil_setStorageAt',[address,slot,value]);
}
await admin('anvil_mine',['0x600']); // Registration at fixture height 1000; archived snapshot hash is publisher-attested.
const addresses=JSON.parse(fs.readFileSync(dir+'/addresses.json','utf8')) as Record<'distributor'|'token'|'alice'|'curve',Address>&{marketId:Hex};
for(const k of ['distributor','token','alice','curve']as const)addresses[k]=addresses[k].toLowerCase() as Address;
const client=createPublicClient({transport:http(url)}),abi=snapshotAbis.HolderRewardsDistributorV1 as Abi;
const exclusions=await client.readContract({address:addresses.distributor,abi,functionName:'feeSharingExcludedAccounts',args:[addresses.marketId]}) as Address[];
const ds=buildSnapshot({chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,distributor:addresses.distributor,marketId:addresses.marketId,token:addresses.token,quote:'0x0000000000000000000000000000000000000000',round:'1',snapshotBlock:'1000',snapshotBlockHash:`0x${'03'.repeat(32)}`,registeredBlock:'1000',lastSnapshotBlock:'0',totalSupply:String(1000n*10n**18n),quoteAvailable:String(10n**18n),memeAvailable:'0',burnMemeFees:false,exclusions:exclusions.map(a=>a.toLowerCase() as Address),balances:[{account:addresses.alice,balance:String(100n*10n**18n)},{account:addresses.curve,balance:String(900n*10n**18n)}]});
const account=privateKeyToAccount(`0x${'1'.padStart(64,'0')}`);
const identity={chainId:46630,releaseId:CURRENT_RELEASE_ID,publisher:account.address};
let result:unknown;
await withPublicationJournal(dir+'/journal',identity,async(journal,save)=>{
 const d:PublicationDependencies={options:{pool:{} as Pool,deployment:{environment:'test',chainId:46630,deploymentDigest:CURRENT_RELEASE_ID,activationBlock:0n},primary:rpc,secondary:second},policy:{publisher:account.address,maxGasWei:10n**17n,confirmations:2,finalitySeconds:0,intentMaxAgeSeconds:300},journal,save,
 // Fixture adapter deliberately replaces production DB/history/pinned-release preflight.
 // Production CLI exposes no override. Unit/DB tests separately cover the production preflight.
 preview:async dataset=>{
  const head=await client.getBlock();
  const round=await client.readContract({address:addresses.distributor,abi,functionName:'roundState',args:[addresses.marketId,1n]}) as {root:Hex;dataHash:Hex};
  if(BigInt(round.root)!==0n){assert.equal(round.root,dataset.root);assert.equal(round.dataHash,dataset.dataHash);return {status:'already_published',headBlock:head.number.toString(),headHash:head.hash};}
  assert.equal((await client.readContract({address:addresses.distributor,abi,functionName:'snapshotPublisher'}) as string).toLowerCase(),account.address.toLowerCase());
  const args=[[{marketId:dataset.input.marketId,round:1n,snapshotBlock:1000n,snapshotBlockHash:dataset.input.snapshotBlockHash,root:dataset.root,dataHash:dataset.dataHash,quoteBudget:BigInt(dataset.quoteBudget),memeBudget:0n}]];
  await client.simulateContract({address:addresses.distributor,abi,functionName:'publishSnapshots',account:account.address,args});
  return {status:'simulated_not_broadcast',from:account.address,to:addresses.distributor,data:encodeFunctionData({abi,functionName:'publishSnapshots',args}),dataHash:dataset.dataHash,headBlock:head.number.toString(),headHash:head.hash};
 }};
 const first=await publishSnapshotOnce(d,ds,{address:account.address,sign:tx=>account.signTransaction(tx)});
 assert.ok(['pending','confirming'].includes(first.status));assert.ok(journal.pending);
 // Round persistence is tested using a reloaded journal, without loading the signer again.
 const persisted=JSON.parse(fs.readFileSync(path.join(dir,'journal',`46630-${account.address.toLowerCase()}.json`),'utf8')) as PublicationJournal;
 d.journal=persisted;await admin('anvil_mine',['0x2']);
 const confirmed=await reconcilePublication(d,ds);assert.equal(confirmed.status,'confirmed');assert.equal(d.journal.pending,null);
 const entry=ds.entries.find(e=>e.account===addresses.alice)!;
 const claim=await client.simulateContract({address:addresses.distributor,abi,functionName:'claimSnapshot',account:addresses.alice,args:[addresses.marketId,1n,BigInt(entry.quoteAmount),0n,1,entry.proof]});
 assert.deepEqual(claim.result,[10n**18n,0n]);
 result={scope:'local real Distributor/Token/AccessManager; fixture Registry/Vault/Hook/clock and preflight; same localhost used as both test RPC transports',firstStatus:first.status,confirmation:confirmed,claimSimulationQuote:entry.quoteAmount};
});
fs.writeFileSync(process.env.TG_LOCAL_PUBLICATION_EVIDENCE ?? 'docs/reviews/evidence/holder-manual-publication-2026-09-13/local-publication.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
