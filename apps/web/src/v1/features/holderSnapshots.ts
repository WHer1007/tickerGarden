import {encodeAbiParameters, keccak256, concat, toHex, type Address, type Hex} from 'viem';
import {currentV4Abis} from '../generated/abis.ts';
import {createContractWriteRequest} from '../transaction.ts';
export const WALLET_SNAPSHOT_MODE = keccak256(toHex('TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_V1'));
const DOMAIN = keccak256(toHex('TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_LEAF_V1'));
export type SnapshotIdentity = Readonly<{chainId:number; distributor:Address; marketId:Hex; account:Address; quote:Address; meme:Address;burnMemeFees?:boolean}>;
export type HolderRound = Readonly<{round:bigint; snapshotBlock:bigint; root:Hex; quoteAmount:bigint; memeAmount:bigint; claimedAssets:number; proof:readonly Hex[]}>;
export type HolderSnapshotPage = Readonly<{identity:SnapshotIdentity; status:'ready'|'awaiting_funding'|'awaiting_publication'|'publisher_unconfigured'; sourceBlock:bigint; sourceHash:Hex; rounds:readonly HolderRound[]; nextCursor:string|null}>;
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid snapshot response');return v as Record<string,unknown>;}
function integer(v:unknown,bits=256):bigint {if(typeof v!=='string'||v.length>78||!/^(0|[1-9][0-9]*)$/.test(v))throw Error('Invalid snapshot amount');const n=BigInt(v);if(n>=1n<<BigInt(bits))throw Error('Snapshot integer overflow');return n;}
function hash(v:unknown):Hex {if(typeof v!=='string'||!/^0x[0-9a-f]{64}$/.test(v)||/^0x0+$/.test(v))throw Error('Invalid snapshot commitment');return v as Hex;}
export function snapshotLeaf(id:SnapshotIdentity, r:Pick<HolderRound,'round'|'quoteAmount'|'memeAmount'>):Hex {
 return keccak256(keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'bytes32'},{type:'uint64'},{type:'address'},{type:'uint256'},{type:'uint256'}],[DOMAIN,BigInt(id.chainId),id.distributor,id.marketId,r.round,id.account,r.quoteAmount,r.memeAmount])));
}
export function snapshotRoot(leaf:Hex,proof:readonly Hex[]):Hex {return proof.reduce((node,sibling)=>keccak256(concat(node.toLowerCase()<sibling.toLowerCase()?[node,sibling]:[sibling,node])),leaf);}
/** DB response is display data. Live root and claimed flags are rechecked only when signing. */
export function parseHolderSnapshots(value:unknown,id:SnapshotIdentity):HolderSnapshotPage {
 const p=record(value);
 if(p.schema!=='TICKERGARDEN_HOLDER_WALLET_SNAPSHOTS_V1'||p.chainId!==id.chainId||p.displayOnly!==true||p.finality!=='finalized')throw Error('Wrong snapshot scope');
 for(const k of ['distributor','marketId','account','quote','meme'] as const)if(p[k]!==id[k].toLowerCase())throw Error(`Snapshot ${k} mismatch`);
 hash(p.sourceBlockHash);const sourceBlock=integer(p.sourceBlockNumber,64);
 if(!['ready','awaiting_funding','awaiting_publication','publisher_unconfigured'].includes(String(p.status)))throw Error('Unknown snapshot status');
 if(!Array.isArray(p.rounds)||p.rounds.length>50)throw Error('Invalid snapshot rounds');
 if(p.nextCursor!==null&&(typeof p.nextCursor!=='string'||p.nextCursor.length===0||p.nextCursor.length>2048))throw Error('Invalid snapshot cursor');
 let last=0n;
 const rounds=p.rounds.map(value=>{const v=record(value);const round=integer(v.round,64),snapshotBlock=integer(v.snapshotBlock,64),root=hash(v.root),quoteAmount=integer(v.quoteAmount),memeAmount=integer(v.memeAmount);
  if(id.burnMemeFees && memeAmount!==0n)throw Error('Burn-mode holder snapshots must be Quote-only');
  if(round<=last||snapshotBlock>=sourceBlock||quoteAmount+memeAmount===0n||!Number.isInteger(v.claimedAssets)||Number(v.claimedAssets)<0||Number(v.claimedAssets)>3||!Array.isArray(v.proof)||v.proof.length>64)throw Error('Invalid snapshot entitlement');
  last=round;const proof=v.proof.map(hash);const r={round,snapshotBlock,root,quoteAmount,memeAmount,claimedAssets:Number(v.claimedAssets),proof};
  if(snapshotRoot(snapshotLeaf(id,r),proof)!==root)throw Error('Snapshot proof does not match root');return Object.freeze(r);
 });
 return Object.freeze({identity:id,status:p.status as HolderSnapshotPage['status'],sourceBlock,sourceHash:p.sourceBlockHash as Hex,rounds:Object.freeze(rounds),nextCursor:p.nextCursor as string|null});
}
export function claimableSnapshotAssets(r:HolderRound):number {return (r.quoteAmount>0n?1:0) | (r.memeAmount>0n?2:0);}
export function remainingSnapshotAssets(r:HolderRound):number {return claimableSnapshotAssets(r)&~r.claimedAssets;}
export function buildSnapshotClaim(id:SnapshotIdentity,r:HolderRound,assets:number) {
 if(id.burnMemeFees && r.memeAmount!==0n)throw Error('Burn-mode holder snapshots must be Quote-only');
 if(![1,2,3].includes(assets)||(assets&remainingSnapshotAssets(r))!==assets)throw Error('Selected snapshot assets are unavailable');
 if(snapshotRoot(snapshotLeaf(id,r),r.proof)!==r.root)throw Error('Invalid snapshot proof');
 return createContractWriteRequest({abi:currentV4Abis.HolderRewardsDistributorV1,address:id.distributor,functionName:'claimSnapshot',args:[id.marketId,r.round,r.quoteAmount,r.memeAmount,assets,r.proof]});
}
export async function fetchHolderSnapshots(baseUrl:string,id:SnapshotIdentity,signal:AbortSignal,cursor?:string):Promise<HolderSnapshotPage> {
 const url=new URL('/v1/holder-snapshots',baseUrl);for(const k of ['chainId','distributor','marketId','account'])url.searchParams.set(k,String(id[k as keyof SnapshotIdentity]).toLowerCase());if(cursor)url.searchParams.set('cursor',cursor);
 const response=await fetch(url,{signal,headers:{accept:'application/json'}});
 if(!response.ok)throw Error('Snapshot rewards are unavailable. Try again later.');
 const body=await response.text();if(body.length>512_000)throw Error('Snapshot response is too large');
 return parseHolderSnapshots(JSON.parse(body),id);
}
