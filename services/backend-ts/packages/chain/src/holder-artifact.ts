import {keccak256,toHex,type Hex} from 'viem';
import {canonicalSnapshotJson,SNAPSHOT_POLICY,verifySnapshot,uint,type SnapshotDataset,type SnapshotInput} from './holder-snapshot.ts';
export type SnapshotManifest={schema:'TICKERGARDEN_HOLDER_MANIFEST_V2';policy:typeof SNAPSHOT_POLICY;input:Omit<SnapshotInput,'balances'>;root:Hex;dataHash:Hex;quoteBudget:string;memeBudget:string;eligibleSupply:string;entryCount:string;balancesDigest:string};
export type SnapshotArtifact=SnapshotDataset|SnapshotManifest;
export function manifestHash(m:Omit<SnapshotManifest,'dataHash'>):Hex{return keccak256(toHex(canonicalSnapshotJson(m)));}
/** This validates manifest identity, not balances: V2 also requires retained database verification evidence. */
export function verifySnapshotArtifact(d:SnapshotArtifact):SnapshotArtifact{
 if(d.schema==='TICKERGARDEN_HOLDER_DATASET_V1')return verifySnapshot(d);
 if(d.schema!=='TICKERGARDEN_HOLDER_MANIFEST_V2'||d.policy!==SNAPSHOT_POLICY)throw Error('invalid snapshot artifact');
 const {dataHash,...m}=d;
 if(manifestHash(m)!==dataHash||!/^0x[0-9a-f]{64}$/.test(d.root)||/^0x0+$/.test(d.root)||!/^[0-9a-f]{64}$/.test(d.balancesDigest))throw Error('snapshot manifest integrity mismatch');
 const i=d.input;if(typeof i.burnMemeFees!=='boolean'||!Array.isArray(i.exclusions)||i.exclusions.length>1000||new Set(i.exclusions).size!==i.exclusions.length)throw Error('invalid snapshot exclusions');
 if(/^0x0+$/.test(i.distributor)||/^0x0+$/.test(i.token)||i.token===i.quote)throw Error('invalid snapshot assets');
 if(!Number.isSafeInteger(i.chainId)||i.chainId<=0)throw Error('invalid snapshot chain');
 for(const a of [i.distributor,i.token,i.quote,...i.exclusions])if(!/^0x[0-9a-f]{40}$/.test(a))throw Error('invalid snapshot address');
 for(const h of [i.marketId,i.deploymentDigest,i.snapshotBlockHash])if(!/^0x[0-9a-f]{64}$/.test(h)||/^0x0+$/.test(h))throw Error('invalid snapshot identity');
 if(!uint(i.round,64)||uint(i.snapshotBlock,64)<=uint(i.lastSnapshotBlock,64)||uint(i.snapshotBlock,64)<uint(i.registeredBlock,64)||!uint(d.entryCount)||!uint(d.eligibleSupply)||uint(d.eligibleSupply)>uint(i.totalSupply)||uint(d.quoteBudget)>uint(i.quoteAvailable)||uint(d.memeBudget)>uint(i.memeAvailable)||! (uint(d.quoteBudget)+uint(d.memeBudget))||i.burnMemeFees&&uint(d.memeBudget)!==0n)throw Error('invalid snapshot manifest amounts');
 if(!i.exclusions.includes(i.distributor)||!i.exclusions.includes(i.token)||!i.exclusions.includes('0x0000000000000000000000000000000000000000'))throw Error('missing protocol exclusions');
 return d;
}
