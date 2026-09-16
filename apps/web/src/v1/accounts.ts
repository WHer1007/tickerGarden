import type {AccountPage, ConfigReadModel, SyncStatus, UserAccountReadModel} from './generated/read-api.ts';
const address=(v:unknown):v is `0x${string}`=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&v!=='0x'+'0'.repeat(40);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const uint=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<2n**256n;

// Commit the complete result only: a failed later page must not expose a partial wallet.
export async function loadWalletAccounts(options:{wallet:string;sync:SyncStatus;assets:readonly ConfigReadModel[];signal:AbortSignal;fetchPage:(cursor?:string)=>Promise<AccountPage>}):Promise<readonly UserAccountReadModel[]> {
 const {sync,signal}=options;
 const wallet=options.wallet.toLowerCase();
 const bad=()=>new Error('Account snapshot is unavailable or inconsistent');
 if(!address(wallet)||sync.status!=='synced'||sync.finality!=='finalized'||!uint(sync.blockNumber)||!hash(sync.blockHash)||sync.revision!==`${sync.blockNumber}:${sync.blockHash}`)throw bad();
 const vaults=new Map(options.assets.filter(a=>a.kind==='asset').map(a=>[a.id,a.values.userStockVault]));
 const rows:UserAccountReadModel[]=[];const cursors=new Set<string>();let cursor:string|undefined;let previous='';
 for(let page=0;page<100;page++) {
  if(signal.aborted)throw bad();
  const result=await options.fetchPage(cursor);
  if(signal.aborted)throw bad();
  if(!result||!result.sync||result.sync.chainId!==sync.chainId||result.sync.revision!==sync.revision||result.sync.blockNumber!==sync.blockNumber||result.sync.blockHash!==sync.blockHash||result.sync.status!=='synced'||result.sync.finality!=='finalized'||!Array.isArray(result.items)||result.items.length>100)throw bad();
  for(const a of result.items){
   if(!a||a.user!==wallet||!hash(a.assetUid)||a.assetUid<=previous||!address(a.vault)||vaults.get(a.assetUid)!==a.vault||![a.deposited,a.allocated,a.free].every(uint)||BigInt(a.deposited)!==BigInt(a.allocated)+BigInt(a.free))throw bad();
   const s=a.source;
   if(!s||s.chainId!==sync.chainId||!uint(s.blockNumber)||BigInt(s.blockNumber)>BigInt(sync.blockNumber)||!hash(s.blockHash)||(s.blockNumber===sync.blockNumber&&s.blockHash!==sync.blockHash)||!hash(s.transactionHash)||![s.transactionIndex,s.logIndex].every(n=>Number.isSafeInteger(n)&&n>=0))throw bad();
   previous=a.assetUid;rows.push(a);
  }
  if(result.nextCursor===null)return rows;
  if(typeof result.nextCursor!=='string'||result.nextCursor.length===0||result.nextCursor.length>1024||cursors.has(result.nextCursor)||result.items.length===0)throw bad();
  cursor=result.nextCursor;cursors.add(cursor);
 }
 throw bad();
}
