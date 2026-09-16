import { concat, encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';

export const SNAPSHOT_MODE = keccak256(toHex('TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_V1'));
export const MAX_SNAPSHOT_HOLDERS=100_000;
export const SNAPSHOT_POLICY = 'DIRECT_BALANCE_PRO_RATA_FLOOR_V1';
const DOMAIN = keccak256(toHex('TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_LEAF_V1'));
export interface SnapshotInput {
  chainId: number; deploymentDigest: Hex; distributor: Address; marketId: Hex; token: Address; quote: Address;
  round: string; snapshotBlock: string; snapshotBlockHash: Hex; registeredBlock: string; lastSnapshotBlock: string;
  totalSupply: string; quoteAvailable: string; memeAvailable: string; burnMemeFees: boolean;
  exclusions: readonly Address[]; balances: readonly { account: Address; balance: string }[];
}
export interface SnapshotEntry { account: Address; balance: string; quoteAmount: string; memeAmount: string; proof: Hex[] }
export interface SnapshotDataset {
  schema: 'TICKERGARDEN_HOLDER_DATASET_V1'; policy: typeof SNAPSHOT_POLICY; input: SnapshotInput;
  root: Hex; dataHash: Hex; quoteBudget: string; memeBudget: string; eligibleSupply: string; entries: SnapshotEntry[];
}
export function uint(value: string, bits = 256): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78 || BigInt(value) >= 1n << BigInt(bits)) throw Error('invalid snapshot integer');
  return BigInt(value);
}
export function snapshotLeaf(chainId: number, distributor: Address, marketId: Hex, round: string, account: Address, quote: string, meme: string): Hex {
  return keccak256(keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'bytes32'},{type:'uint64'},{type:'address'},{type:'uint256'},{type:'uint256'}],
    [DOMAIN,BigInt(chainId),distributor,marketId,uint(round,64),account,uint(quote),uint(meme)])));
}
function pair(a: Hex, b: Hex): Hex { return keccak256(concat(a < b ? [a,b] : [b,a])); }
export function proofRoot(leaf: Hex, proof: readonly Hex[]): Hex { return proof.reduce(pair, leaf); }
export function buildSnapshot(input: SnapshotInput): SnapshotDataset {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw Error('invalid snapshot chain');
  for (const h of [input.deploymentDigest,input.marketId,input.snapshotBlockHash]) if (!/^0x[0-9a-f]{64}$/.test(h) || /^0x0+$/.test(h)) throw Error('invalid snapshot hash');
  for (const a of [input.distributor,input.token,input.quote,...input.exclusions]) if (!/^0x[0-9a-f]{40}$/.test(a)) throw Error('invalid snapshot address');
  if (/^0x0+$/.test(input.distributor) || /^0x0+$/.test(input.token) || input.token === input.quote) throw Error('invalid snapshot assets');
  const height = uint(input.snapshotBlock,64);
  if (!uint(input.round,64) || height < uint(input.registeredBlock,64) || height <= uint(input.lastSnapshotBlock,64)) throw Error('invalid snapshot order');
  if (input.balances.length > MAX_SNAPSHOT_HOLDERS || input.exclusions.length > 1000 || new Set(input.exclusions).size !== input.exclusions.length) throw Error('snapshot input bound');
  const exclusions = new Set(input.exclusions);
  if (!exclusions.has('0x0000000000000000000000000000000000000000') || !exclusions.has(input.distributor) || !exclusions.has(input.token)) throw Error('missing protocol exclusions');
  const balances = [...input.balances].sort((a,b) => a.account.localeCompare(b.account));
  let total = 0n; const seen = new Set<string>();
  for (const row of balances) {
    if (!/^0x[0-9a-f]{40}$/.test(row.account) || seen.has(row.account) || /^0x0+$/.test(row.account)) throw Error('invalid or duplicate holder');
    seen.add(row.account); total += uint(row.balance);
  }
  if (total !== uint(input.totalSupply)) throw Error('snapshot supply mismatch');
  const eligible = balances.filter(r => !exclusions.has(r.account) && uint(r.balance) > 0n);
  const supply = eligible.reduce((sum,r) => sum + uint(r.balance),0n);
  if (!supply) throw Error('no eligible holders');
  const quote = uint(input.quoteAvailable), meme = uint(input.memeAvailable);
  if (input.burnMemeFees && meme) throw Error('burn-mode Meme funding');
  const entries: SnapshotEntry[] = eligible.map(r => ({...r,quoteAmount:(quote*uint(r.balance)/supply).toString(),memeAmount:(meme*uint(r.balance)/supply).toString(),proof:[]}))
    .filter(r => uint(r.quoteAmount)+uint(r.memeAmount)>0n);
  if (!entries.length) throw Error('no distributable budget');
  // Promote an unpaired last node. Every non-promoted edge uses the contract's sorted-pair hash.
  const levels: Hex[][] = [entries.map(r => snapshotLeaf(input.chainId,input.distributor,input.marketId,input.round,r.account,r.quoteAmount,r.memeAmount))];
  while (levels.at(-1)!.length > 1) {
    const previous=levels.at(-1)!, next:Hex[]=[];
    for(let i=0;i<previous.length;i+=2)next.push(previous[i+1] ? pair(previous[i]!,previous[i+1]!) : previous[i]!);
    levels.push(next);
  }
  entries.forEach((entry,index)=>{let cursor=index;for(const level of levels.slice(0,-1)){const sibling=level[cursor^1];if(sibling)entry.proof.push(sibling);cursor=Math.floor(cursor/2);}});
  const root=levels.at(-1)![0]!;
  const normalized:SnapshotInput={...input,exclusions:[...input.exclusions].sort(),balances};
  const payload={schema:'TICKERGARDEN_HOLDER_DATASET_V1' as const,policy:SNAPSHOT_POLICY as typeof SNAPSHOT_POLICY,input:normalized,root,
    quoteBudget:entries.reduce((s,r)=>s+uint(r.quoteAmount),0n).toString(),memeBudget:entries.reduce((s,r)=>s+uint(r.memeAmount),0n).toString(),eligibleSupply:supply.toString(),entries};
  return {...payload,dataHash:keccak256(toHex(canonicalSnapshotJson(payload)))};
}
export function canonicalSnapshotJson(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonicalSnapshotJson).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalSnapshotJson((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function verifySnapshot(dataset: SnapshotDataset): SnapshotDataset {
  const expected=buildSnapshot(dataset.input);
  if (canonicalSnapshotJson(expected)!==canonicalSnapshotJson(dataset)) throw Error('snapshot dataset integrity mismatch');
  return expected;
}

/** Store inputs and commitments once; per-wallet proofs live in the indexed table. */
export function compactSnapshotDataset(dataset:SnapshotDataset){const {entries,...compact}=dataset;return compact;}
