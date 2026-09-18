import {decodeEventLog,encodeFunctionData,keccak256,parseTransaction,recoverTransactionAddress,toHex,type Abi,type Address,type Hex,type TransactionSerialized} from 'viem';
import {verifySnapshotArtifact,type SnapshotArtifact} from '../../chain/src/holder-artifact.ts';
import {consensusBlock,type RpcTransport} from '../../chain/src/index.ts';
import {snapshotAbis} from '../../events/src/f72-abis.generated.ts';
import {previewSnapshotPublication,type SnapshotOptions} from './holder-snapshots.ts';

const abi=snapshotAbis.HolderRewardsDistributorV1 as Abi;
const same=(a:unknown,b:unknown)=>String(a).toLowerCase()===String(b).toLowerCase();
export interface PublicationPolicy {publisher:Address;maxGasWei:bigint;confirmations:number;finalitySeconds:number;finalityMode?:'finalized'|'delay';intentMaxAgeSeconds:number}
export interface PublicationTransaction {chainId:number;to:Address;data:Hex;value:bigint;gas:bigint;gasPrice:bigint;nonce:number;type:'legacy'}
export interface PublicationSigner {address:Address;sign(transaction:PublicationTransaction):Promise<Hex>}
export interface PublicationIntent {
 dataHash:Hex;root:Hex;marketId:Hex;round:string;distributor:Address;publisher:Address;chainId:number;releaseId:Hex;
 batchDataHashes?:Hex[];hash:Hex;raw:Hex;nonce:number;createdAt:string;expiresAt:string;
}
export interface PublicationJournal {
 chainId:number;releaseId:Hex;publisher:Address;pending:PublicationIntent|null;
 last?:{status:string;dataHash:Hex;hash?:Hex;blockNumber?:string;blockHash?:Hex;gasWei?:string};
 lastError?:{at:string;error:string};
}
interface Receipt {transactionHash:Hex;blockHash:Hex;blockNumber:Hex;status:Hex;gasUsed:Hex;effectiveGasPrice:Hex;logs:{address:Address;data:Hex;topics:[Hex,...Hex[]]}[]}
type Preview=Awaited<ReturnType<typeof previewSnapshotPublication>>;
export interface PublicationDependencies {
 options:SnapshotOptions;policy:PublicationPolicy;journal:PublicationJournal;
 save(journal:PublicationJournal):Promise<void>;
 /** Test seam: production always uses previewSnapshotPublication. */
 preview?:(dataset:SnapshotArtifact)=>Promise<Preview>;
}
function validate(d:PublicationDependencies,dataset:SnapshotArtifact){
 verifySnapshotArtifact(dataset);
 const {policy:p,journal:j,options:o}=d;
 if(p.finalityMode!==undefined&&!['finalized','delay'].includes(p.finalityMode))throw Error('Invalid publication policy');
 if(!/^0x[0-9a-f]{40}$/i.test(p.publisher)||BigInt(p.publisher)===0n||p.maxGasWei<=0n||!Number.isInteger(p.confirmations)||p.confirmations<2||!Number.isInteger(p.finalitySeconds)||p.finalitySeconds<0||!Number.isInteger(p.intentMaxAgeSeconds)||p.intentMaxAgeSeconds<30||p.intentMaxAgeSeconds>300)throw Error('Invalid publication policy');
 if(j.chainId!==o.deployment.chainId||j.releaseId!==o.deployment.deploymentDigest||!same(j.publisher,p.publisher)||dataset.input.chainId!==j.chainId||dataset.input.deploymentDigest!==j.releaseId)throw Error('Publication journal/deployment mismatch');
}
type PublicationInput=SnapshotArtifact|readonly SnapshotArtifact[];
function artifacts(input:PublicationInput):readonly SnapshotArtifact[]{
 const rows=Array.isArray(input)?input:[input as SnapshotArtifact];
 if(rows.length<1||rows.length>32||new Set(rows.map(r=>r.input.marketId.toLowerCase())).size!==rows.length)throw Error('Publication batch requires 1 to 32 distinct markets');
 for(const r of rows)if(r.input.chainId!==rows[0]!.input.chainId||r.input.deploymentDigest!==rows[0]!.input.deploymentDigest||!same(r.input.distributor,rows[0]!.input.distributor))throw Error('Publication batch deployment mismatch');
 return rows;
}
function calldata(input:PublicationInput):Hex {
 return encodeFunctionData({abi,functionName:'publishSnapshots',args:[artifacts(input).map(dataset=>{const i=dataset.input;return {marketId:i.marketId,round:BigInt(i.round),snapshotBlock:BigInt(i.snapshotBlock),snapshotBlockHash:i.snapshotBlockHash,root:dataset.root,dataHash:dataset.dataHash,quoteBudget:BigInt(dataset.quoteBudget),memeBudget:BigInt(dataset.memeBudget)};})]});
}
const receiptLogs=(r:Receipt)=>JSON.stringify(r.logs.map(l=>({address:l.address.toLowerCase(),data:l.data.toLowerCase(),topics:l.topics.map(t=>t.toLowerCase())})));
async function chains(d:PublicationDependencies){
 for(const rpc of [d.options.primary,d.options.secondary])if(BigInt(await rpc.call<string>('eth_chainId',[]))!==BigInt(d.journal.chainId))throw Error('Publication RPC chain mismatch');
}
async function head(d:PublicationDependencies){
 const blocks=await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call<{number:Hex}>('eth_getBlockByNumber',['latest',false])));
 const height=BigInt(blocks[0]!.number)<BigInt(blocks[1]!.number)?BigInt(blocks[0]!.number):BigInt(blocks[1]!.number);
 return consensusBlock(d.options.primary,d.options.secondary,height);
}
async function preflight(d:PublicationDependencies,dataset:SnapshotArtifact){
 const p=await (d.preview??(ds=>previewSnapshotPublication(d.options,ds)))(dataset);
 if(p.status==='publisher_unconfigured')throw Error('Snapshot publisher is not configured');
 if(p.status==='simulated_not_broadcast'&&(!same(p.from,d.policy.publisher)||!same(p.to,dataset.input.distributor)||p.data!==calldata(dataset)||p.dataHash!==dataset.dataHash))throw Error('Preview identity/calldata mismatch');
 return p;
}
async function preflightBatch(d:PublicationDependencies,input:PublicationInput){
 const rows=artifacts(input),results=[];
 for(const row of rows)results.push(await preflight(d,row));
 const published=results.filter(r=>r.status==='already_published').length;
 if(published&&published!==rows.length)throw Error('Publication batch partially published; reconcile datasets before signing');
 if(rows.length===1)return results[0]!;
 // Earlier per-market checks may span many fast blocks. A final atomic batch simulation
 // validates every current budget/round together at one fresh anchor before signing.
 const current=await head(d);
 if(!published)await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call('eth_call',[{from:d.policy.publisher,to:rows[0]!.input.distributor,data:calldata(input),value:'0x0'},toHex(current.number)])));
 if(!same((await consensusBlock(d.options.primary,d.options.secondary,current.number)).hash,current.hash))throw Error('Publication batch simulation anchor changed');
 return {...results[0]!,headBlock:String(current.number),headHash:current.hash};
}
async function validateIntent(d:PublicationDependencies,input:PublicationInput,row:PublicationIntent){
 const rows=artifacts(input),ds=rows[0]!;
 if(JSON.stringify(row.batchDataHashes??[row.dataHash])!==JSON.stringify(rows.map(r=>r.dataHash)))throw Error('Pending batch differs from signed datasets');
 if(row.chainId!==d.journal.chainId||row.releaseId!==d.journal.releaseId||!same(row.publisher,d.policy.publisher)||row.dataHash!==ds.dataHash||row.root!==ds.root||row.marketId!==ds.input.marketId||row.round!==ds.input.round||!same(row.distributor,ds.input.distributor)||keccak256(row.raw)!==row.hash)throw Error('Pending intent belongs to another dataset or is corrupt');
 const tx=parseTransaction(row.raw);
 if(tx.chainId!==row.chainId||!same(tx.to,row.distributor)||tx.data!==calldata(input)||(tx.value??0n)!==0n||tx.nonce!==row.nonce||tx.type!=='legacy'||tx.gas===undefined||tx.gasPrice===undefined||tx.gas*tx.gasPrice>d.policy.maxGasWei||!same(await recoverTransactionAddress({serializedTransaction:row.raw as TransactionSerialized}),row.publisher))throw Error('Signed publication intent mismatch');
}
export function publicationReceiptMatches(receipt:Receipt,row:PublicationIntent,input:PublicationInput){
 const rows=artifacts(input);
 if(!same(receipt.transactionHash,row.hash))throw Error('Receipt transaction mismatch');
 if(receipt.status!=='0x1'&&receipt.status!=='0x0')throw Error('Invalid publication receipt status');
 if(receipt.status!=='0x1')return false;
 const events=receipt.logs.filter(l=>same(l.address,row.distributor)).flatMap(l=>{try{return [decodeEventLog({abi,data:l.data,topics:l.topics,strict:true})]}catch{return [];}}).filter(e=>e.eventName==='HolderSnapshotPublished');
 if(events.length!==rows.length)throw Error('Unexpected snapshot publication event count');
 for(const ds of rows){
 const matches=events.filter(e=>same((e.args as unknown as Record<string,unknown>).marketId,ds.input.marketId));
 if(matches.length!==1)throw Error('Published event differs from signed dataset');
 const a=matches[0]!.args as unknown as Record<string,unknown>;
 for(const [field,expected]of Object.entries({marketId:ds.input.marketId,round:ds.input.round,snapshotBlock:ds.input.snapshotBlock,snapshotBlockHash:ds.input.snapshotBlockHash,root:ds.root,dataHash:ds.dataHash,quoteBudget:ds.quoteBudget,memeBudget:ds.memeBudget}))if(!same(a[field],expected))throw Error('Published event differs from signed dataset');
 }
 return true;
}

/** Read-only reconciliation. No signing or rebroadcasting, and no optimistic published DB writes. */
export async function reconcilePublication(d:PublicationDependencies,input:PublicationInput){
 const rows=artifacts(input),ds=rows[0]!;for(const dataset of rows)validate(d,dataset);await chains(d);
 const row=d.journal.pending;
 if(!row){const result=await preflightBatch(d,input);return {status:result.status==='already_published'?'already_published':'no_pending_intent',dataHash:ds.dataHash};}
 await validateIntent(d,input,row);
 const receipts=await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call<Receipt|null>('eth_getTransactionReceipt',[row.hash])));
 if(!receipts[0]||!receipts[1])return {status:'pending',hash:row.hash,dataHash:ds.dataHash};
 const [a,b]=receipts as [Receipt,Receipt];
 // Confirm both providers saw the same transaction, status and complete publication logs.
 if(!same(a.transactionHash,b.transactionHash)||!same(a.blockHash,b.blockHash)||BigInt(a.blockNumber)!==BigInt(b.blockNumber)||a.status!==b.status||receiptLogs(a)!==receiptLogs(b))throw Error('Publication receipt RPC disagreement');
 const height=BigInt(a.blockNumber),current=await head(d);
 if(current.number<height)return {status:'confirming',hash:row.hash,dataHash:ds.dataHash};
 const block=await consensusBlock(d.options.primary,d.options.secondary,height);
 if(!same(block.hash,a.blockHash))throw Error('Publication receipt is orphaned');
 let settled=current.timestamp>=block.timestamp+BigInt(d.policy.finalitySeconds);
 if(d.policy.finalityMode==='finalized'){const finals=await Promise.all([d.options.primary,d.options.secondary].map(r=>r.finalizedBlock()));const finalHeight=finals[0]!.number<finals[1]!.number?finals[0]!.number:finals[1]!.number;for(const final of finals)if(!same((await consensusBlock(d.options.primary,d.options.secondary,final.number)).hash,final.hash))throw Error('Publication finalized anchor changed');settled=height<=finalHeight;}
 if(current.number-height+1n<BigInt(d.policy.confirmations)||!settled)return {status:'confirming',hash:row.hash,dataHash:ds.dataHash};
 const success=publicationReceiptMatches(a,row,input);
 if(success&&(await preflightBatch(d,input)).status!=='already_published')throw Error('Confirmed receipt has no matching current round');
 // Recheck the receipt anchor after the (potentially long) dataset verification.
 if(!same((await consensusBlock(d.options.primary,d.options.secondary,height)).hash,a.blockHash))throw Error('Publication confirmation anchor changed');
 d.journal.last={status:success?'confirmed':'reverted',dataHash:ds.dataHash,hash:row.hash,blockNumber:height.toString(),blockHash:a.blockHash,gasWei:(BigInt(a.gasUsed)*BigInt(a.effectiveGasPrice)).toString()};
 d.journal.pending=null;
 await d.save(d.journal);
 return d.journal.last;
}

async function sendPending(d:PublicationDependencies,input:PublicationInput){
 const ds=artifacts(input)[0]!;
 const row=d.journal.pending!;
 const result=await reconcilePublication(d,input);
 if(result.status!=='pending')return result;
 const nonces=await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call<Hex>('eth_getTransactionCount',[row.publisher,'latest'])));
 if(nonces.some(n=>BigInt(n)>BigInt(row.nonce)))throw Error('Publication nonce consumed without matching receipts; reconcile manually');
 if((await head(d)).timestamp>=BigInt(row.expiresAt))throw Error('Unresolved publication intent expired; do not replace before nonce reconciliation');
 const p=await preflightBatch(d,input);
 if(p.status==='already_published')return {status:'pending_nonce_reconciliation',hash:row.hash,dataHash:ds.dataHash};
 if((await head(d)).timestamp>=BigInt(row.expiresAt))throw Error('Unresolved publication intent expired; do not replace before nonce reconciliation');
 try{
  const sent=await d.options.primary.call<Hex>('eth_sendRawTransaction',[row.raw]);
  if(!same(sent,row.hash))throw Error('Wrong transaction hash');
 }catch{throw Error('Publication submission uncertain; original signed intent retained');}
 return reconcilePublication(d,input);
}

/** Explicit one-shot signer path. Every invocation uses a verified dataset, never cached preview calldata. */
export async function publishSnapshotOnce(d:PublicationDependencies,input:PublicationInput,signer:PublicationSigner){
 const rows=artifacts(input),ds=rows[0]!;for(const dataset of rows)validate(d,dataset);await chains(d);
 if(!same(signer.address,d.policy.publisher))throw Error('Signer differs from configured publisher');
 if(d.journal.pending)return sendPending(d,input);
 const preview=await preflightBatch(d,input);
 if(preview.status==='already_published')return {status:'already_published',dataHash:ds.dataHash};
 const rpc=d.options.primary,tx={from:signer.address,to:ds.input.distributor,data:calldata(input),value:'0x0'};
 const reads=await Promise.all([d.options.primary,d.options.secondary].flatMap(r=>['latest','pending'].map(tag=>r.call<Hex>('eth_getTransactionCount',[signer.address,tag]))));
 if(reads.some(n=>BigInt(n)!==BigInt(reads[0]!))||BigInt(reads[0]!)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Publisher nonce disagreement or outstanding transaction');
 const estimates=await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call<Hex>('eth_estimateGas',[tx])));
 const gas=(estimates.map(BigInt).reduce((a,b)=>a>b?a:b)*120n+99n)/100n;
 const gasPrice=(BigInt(await rpc.call<Hex>('eth_gasPrice',[]))*120n+99n)/100n;
 if(gas<=0n||gasPrice<=0n||gas*gasPrice>d.policy.maxGasWei)throw Error('Publication exceeds configured gas cost cap');
 if(BigInt(await rpc.call<Hex>('eth_getBalance',[signer.address,'latest']))<gas*gasPrice)throw Error('Publisher gas balance insufficient');
 const fresh=await preflightBatch(d,input);
 if(fresh.status==='already_published')return {status:'already_published',dataHash:ds.dataHash};
 const current=await head(d);
 if(current.number<BigInt(fresh.headBlock)||current.number-BigInt(fresh.headBlock)>2n)throw Error('Publication preflight became stale');
 await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call('eth_call',[{...tx,gas:toHex(gas)},'latest'])));
 const freshNonces=await Promise.all([d.options.primary,d.options.secondary].flatMap(r=>['latest','pending'].map(tag=>r.call<Hex>('eth_getTransactionCount',[signer.address,tag]))));
 if(freshNonces.some(n=>BigInt(n)!==BigInt(reads[0]!)))throw Error('Publisher nonce changed before signing');
 const nonce=Number(BigInt(reads[0]!));
 const raw=await signer.sign({chainId:d.journal.chainId,to:ds.input.distributor,data:tx.data,value:0n,gas,gasPrice,nonce,type:'legacy'});
 const row:PublicationIntent={...(rows.length>1?{batchDataHashes:rows.map(r=>r.dataHash)}:{}),dataHash:ds.dataHash,root:ds.root,marketId:ds.input.marketId,round:ds.input.round,distributor:ds.input.distributor,publisher:signer.address,chainId:d.journal.chainId,releaseId:d.journal.releaseId,hash:keccak256(raw),raw,nonce,createdAt:current.timestamp.toString(),expiresAt:(current.timestamp+BigInt(d.policy.intentMaxAgeSeconds)).toString()};
 await validateIntent(d,input,row);
 d.journal.pending=row;
 await d.save(d.journal); // The only path to submission starts after durable persistence.
 return sendPending(d,input);
}
