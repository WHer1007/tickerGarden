import {decodeEventLog,encodeFunctionData,keccak256,parseTransaction,recoverTransactionAddress,toHex,type Abi,type Address,type Hex,type TransactionSerialized} from 'viem';
import {verifySnapshot,type SnapshotDataset} from '../../chain/src/holder-snapshot.ts';
import {consensusBlock,type RpcTransport} from '../../chain/src/index.ts';
import {snapshotAbis} from '../../events/src/f72-abis.generated.ts';
import {previewSnapshotPublication,type SnapshotOptions} from './holder-snapshots.ts';

const abi=snapshotAbis.HolderRewardsDistributorV1 as Abi;
const same=(a:unknown,b:unknown)=>String(a).toLowerCase()===String(b).toLowerCase();
export interface PublicationPolicy {publisher:Address;maxGasWei:bigint;confirmations:number;finalitySeconds:number;intentMaxAgeSeconds:number}
export interface PublicationTransaction {chainId:number;to:Address;data:Hex;value:bigint;gas:bigint;gasPrice:bigint;nonce:number;type:'legacy'}
export interface PublicationSigner {address:Address;sign(transaction:PublicationTransaction):Promise<Hex>}
export interface PublicationIntent {
 dataHash:Hex;root:Hex;marketId:Hex;round:string;distributor:Address;publisher:Address;chainId:number;releaseId:Hex;
 hash:Hex;raw:Hex;nonce:number;createdAt:string;expiresAt:string;
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
 preview?:(dataset:SnapshotDataset)=>Promise<Preview>;
}
function validate(d:PublicationDependencies,dataset:SnapshotDataset){
 verifySnapshot(dataset);
 const {policy:p,journal:j,options:o}=d;
 if(!/^0x[0-9a-f]{40}$/i.test(p.publisher)||BigInt(p.publisher)===0n||p.maxGasWei<=0n||!Number.isInteger(p.confirmations)||p.confirmations<2||!Number.isInteger(p.finalitySeconds)||p.finalitySeconds<0||!Number.isInteger(p.intentMaxAgeSeconds)||p.intentMaxAgeSeconds<30||p.intentMaxAgeSeconds>300)throw Error('Invalid publication policy');
 if(j.chainId!==o.deployment.chainId||j.releaseId!==o.deployment.deploymentDigest||!same(j.publisher,p.publisher)||dataset.input.chainId!==j.chainId||dataset.input.deploymentDigest!==j.releaseId)throw Error('Publication journal/deployment mismatch');
}
function calldata(dataset:SnapshotDataset):Hex {
 const i=dataset.input;
 return encodeFunctionData({abi,functionName:'publishSnapshots',args:[[{marketId:i.marketId,round:BigInt(i.round),snapshotBlock:BigInt(i.snapshotBlock),snapshotBlockHash:i.snapshotBlockHash,root:dataset.root,dataHash:dataset.dataHash,quoteBudget:BigInt(dataset.quoteBudget),memeBudget:BigInt(dataset.memeBudget)}]]});
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
async function preflight(d:PublicationDependencies,dataset:SnapshotDataset){
 const p=await (d.preview??(ds=>previewSnapshotPublication(d.options,ds)))(dataset);
 if(p.status==='publisher_unconfigured')throw Error('Snapshot publisher is not configured');
 if(p.status==='simulated_not_broadcast'&&(!same(p.from,d.policy.publisher)||!same(p.to,dataset.input.distributor)||p.data!==calldata(dataset)||p.dataHash!==dataset.dataHash))throw Error('Preview identity/calldata mismatch');
 return p;
}
async function validateIntent(d:PublicationDependencies,ds:SnapshotDataset,row:PublicationIntent){
 if(row.chainId!==d.journal.chainId||row.releaseId!==d.journal.releaseId||!same(row.publisher,d.policy.publisher)||row.dataHash!==ds.dataHash||row.root!==ds.root||row.marketId!==ds.input.marketId||row.round!==ds.input.round||!same(row.distributor,ds.input.distributor)||keccak256(row.raw)!==row.hash)throw Error('Pending intent belongs to another dataset or is corrupt');
 const tx=parseTransaction(row.raw);
 if(tx.chainId!==row.chainId||!same(tx.to,row.distributor)||tx.data!==calldata(ds)||(tx.value??0n)!==0n||tx.nonce!==row.nonce||tx.type!=='legacy'||tx.gas===undefined||tx.gasPrice===undefined||tx.gas*tx.gasPrice>d.policy.maxGasWei||!same(await recoverTransactionAddress({serializedTransaction:row.raw as TransactionSerialized}),row.publisher))throw Error('Signed publication intent mismatch');
}
export function publicationReceiptMatches(receipt:Receipt,row:PublicationIntent,ds:SnapshotDataset){
 if(!same(receipt.transactionHash,row.hash))throw Error('Receipt transaction mismatch');
 if(receipt.status!=='0x1'&&receipt.status!=='0x0')throw Error('Invalid publication receipt status');
 if(receipt.status!=='0x1')return false;
 const events=receipt.logs.filter(l=>same(l.address,row.distributor)).flatMap(l=>{try{return [decodeEventLog({abi,data:l.data,topics:l.topics,strict:true})]}catch{return [];}}).filter(e=>e.eventName==='HolderSnapshotPublished');
 if(events.length!==1)throw Error('Expected exactly one snapshot publication event');
 const a=events[0]!.args as unknown as Record<string,unknown>;
 for(const [field,expected]of Object.entries({marketId:ds.input.marketId,round:ds.input.round,snapshotBlock:ds.input.snapshotBlock,snapshotBlockHash:ds.input.snapshotBlockHash,root:ds.root,dataHash:ds.dataHash,quoteBudget:ds.quoteBudget,memeBudget:ds.memeBudget}))if(!same(a[field],expected))throw Error('Published event differs from signed dataset');
 return true;
}

/** Read-only reconciliation. No signing or rebroadcasting, and no optimistic published DB writes. */
export async function reconcilePublication(d:PublicationDependencies,ds:SnapshotDataset){
 validate(d,ds);await chains(d);
 const row=d.journal.pending;
 if(!row){const result=await preflight(d,ds);return {status:result.status==='already_published'?'already_published':'no_pending_intent',dataHash:ds.dataHash};}
 await validateIntent(d,ds,row);
 const receipts=await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call<Receipt|null>('eth_getTransactionReceipt',[row.hash])));
 if(!receipts[0]||!receipts[1])return {status:'pending',hash:row.hash,dataHash:ds.dataHash};
 const [a,b]=receipts as [Receipt,Receipt];
 // Confirm both providers saw the same transaction, status and complete publication logs.
 if(!same(a.transactionHash,b.transactionHash)||!same(a.blockHash,b.blockHash)||BigInt(a.blockNumber)!==BigInt(b.blockNumber)||a.status!==b.status||receiptLogs(a)!==receiptLogs(b))throw Error('Publication receipt RPC disagreement');
 const height=BigInt(a.blockNumber),current=await head(d);
 if(current.number<height)return {status:'confirming',hash:row.hash,dataHash:ds.dataHash};
 const block=await consensusBlock(d.options.primary,d.options.secondary,height);
 if(!same(block.hash,a.blockHash))throw Error('Publication receipt is orphaned');
 if(current.number-height+1n<BigInt(d.policy.confirmations)||current.timestamp<block.timestamp+BigInt(d.policy.finalitySeconds))return {status:'confirming',hash:row.hash,dataHash:ds.dataHash};
 const success=publicationReceiptMatches(a,row,ds);
 if(success&&(await preflight(d,ds)).status!=='already_published')throw Error('Confirmed receipt has no matching current round');
 // Recheck the receipt anchor after the (potentially long) dataset verification.
 if(!same((await consensusBlock(d.options.primary,d.options.secondary,height)).hash,a.blockHash))throw Error('Publication confirmation anchor changed');
 d.journal.last={status:success?'confirmed':'reverted',dataHash:ds.dataHash,hash:row.hash,blockNumber:height.toString(),blockHash:a.blockHash,gasWei:(BigInt(a.gasUsed)*BigInt(a.effectiveGasPrice)).toString()};
 d.journal.pending=null;
 await d.save(d.journal);
 return d.journal.last;
}

async function sendPending(d:PublicationDependencies,ds:SnapshotDataset){
 const row=d.journal.pending!;
 const result=await reconcilePublication(d,ds);
 if(result.status!=='pending')return result;
 const nonces=await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call<Hex>('eth_getTransactionCount',[row.publisher,'latest'])));
 if(nonces.some(n=>BigInt(n)>BigInt(row.nonce)))throw Error('Publication nonce consumed without matching receipts; reconcile manually');
 if((await head(d)).timestamp>=BigInt(row.expiresAt))throw Error('Unresolved publication intent expired; do not replace before nonce reconciliation');
 const p=await preflight(d,ds);
 if(p.status==='already_published')return {status:'pending_nonce_reconciliation',hash:row.hash,dataHash:ds.dataHash};
 if((await head(d)).timestamp>=BigInt(row.expiresAt))throw Error('Unresolved publication intent expired; do not replace before nonce reconciliation');
 try{
  const sent=await d.options.primary.call<Hex>('eth_sendRawTransaction',[row.raw]);
  if(!same(sent,row.hash))throw Error('Wrong transaction hash');
 }catch{throw Error('Publication submission uncertain; original signed intent retained');}
 return reconcilePublication(d,ds);
}

/** Explicit one-shot signer path. Every invocation uses a verified dataset, never cached preview calldata. */
export async function publishSnapshotOnce(d:PublicationDependencies,ds:SnapshotDataset,signer:PublicationSigner){
 validate(d,ds);await chains(d);
 if(!same(signer.address,d.policy.publisher))throw Error('Signer differs from configured publisher');
 if(d.journal.pending)return sendPending(d,ds);
 const preview=await preflight(d,ds);
 if(preview.status==='already_published')return {status:'already_published',dataHash:ds.dataHash};
 const rpc=d.options.primary,tx={from:signer.address,to:ds.input.distributor,data:calldata(ds),value:'0x0'};
 const reads=await Promise.all([d.options.primary,d.options.secondary].flatMap(r=>['latest','pending'].map(tag=>r.call<Hex>('eth_getTransactionCount',[signer.address,tag]))));
 if(reads.some(n=>BigInt(n)!==BigInt(reads[0]!))||BigInt(reads[0]!)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Publisher nonce disagreement or outstanding transaction');
 const estimates=await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call<Hex>('eth_estimateGas',[tx])));
 const gas=(estimates.map(BigInt).reduce((a,b)=>a>b?a:b)*120n+99n)/100n;
 const gasPrice=(BigInt(await rpc.call<Hex>('eth_gasPrice',[]))*120n+99n)/100n;
 if(gas<=0n||gasPrice<=0n||gas*gasPrice>d.policy.maxGasWei)throw Error('Publication exceeds configured gas cost cap');
 if(BigInt(await rpc.call<Hex>('eth_getBalance',[signer.address,'latest']))<gas*gasPrice)throw Error('Publisher gas balance insufficient');
 const fresh=await preflight(d,ds);
 if(fresh.status==='already_published')return {status:'already_published',dataHash:ds.dataHash};
 const current=await head(d);
 if(current.number<BigInt(fresh.headBlock)||current.number-BigInt(fresh.headBlock)>2n)throw Error('Publication preflight became stale');
 await Promise.all([d.options.primary,d.options.secondary].map(r=>r.call('eth_call',[{...tx,gas:toHex(gas)},'latest'])));
 const nonce=Number(BigInt(reads[0]!));
 const raw=await signer.sign({chainId:d.journal.chainId,to:ds.input.distributor,data:tx.data,value:0n,gas,gasPrice,nonce,type:'legacy'});
 const row:PublicationIntent={dataHash:ds.dataHash,root:ds.root,marketId:ds.input.marketId,round:ds.input.round,distributor:ds.input.distributor,publisher:signer.address,chainId:d.journal.chainId,releaseId:d.journal.releaseId,hash:keccak256(raw),raw,nonce,createdAt:current.timestamp.toString(),expiresAt:(current.timestamp+BigInt(d.policy.intentMaxAgeSeconds)).toString()};
 await validateIntent(d,ds,row);
 d.journal.pending=row;
 await d.save(d.journal); // The only path to submission starts after durable persistence.
 return sendPending(d,ds);
}
