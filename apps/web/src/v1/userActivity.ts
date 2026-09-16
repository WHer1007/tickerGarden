import type { UserActivityPage, UserActivityRecord } from './generated/read-api.ts';

const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v);
const quantity = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const position = (r: UserActivityRecord) => [BigInt(r.blockNumber), BigInt(r.transactionIndex), BigInt(r.logIndex)];
function earlier(a: UserActivityRecord, b: UserActivityRecord): boolean {
  const left = position(a), right = position(b);
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i]! > right[i]!; }
  return false;
}

export function validateUserActivity(value: unknown, chain: number, account: string, limit: number, previous?: UserActivityPage): UserActivityPage {
  const p = value as UserActivityPage;
  const fail = (): never => { throw new Error('User activity history is inconsistent'); };
  if (!p || !address(account) || p.chainId !== chain || p.account !== account || p.displayOnly !== true || p.finality !== 'finalized' || !quantity(p.indexedFrom) || !quantity(p.sourceBlockNumber) || BigInt(p.indexedFrom) > BigInt(p.sourceBlockNumber) || !hash(p.sourceBlockHash) || typeof p.revision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(p.revision) || typeof p.observedAt !== 'string' || !Number.isFinite(Date.parse(p.observedAt))) fail();
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Array.isArray(p.items) || p.items.length > limit || (p.nextCursor !== null && (typeof p.nextCursor !== 'string' || p.nextCursor.length === 0 || p.nextCursor.length > 1024 || p.items.length === 0))) fail();
  if (previous && (previous.chainId !== chain || previous.account !== account || previous.revision !== p.revision || previous.indexedFrom !== p.indexedFrom || previous.sourceBlockNumber !== p.sourceBlockNumber || previous.sourceBlockHash !== p.sourceBlockHash || previous.nextCursor === null || previous.nextCursor === p.nextCursor)) fail();
  const seen = new Set(previous?.items.map(r => r.id));
  let last = previous?.items.at(-1);
  for (const r of p.items) {
    if (!r || r.chainId !== chain || r.account !== account || r.identityBasis !== 'event_address_reference_not_verified_initiator' || !address(r.emitter) || !hash(r.blockHash) || !hash(r.transactionHash) || ![r.blockNumber, r.transactionIndex, r.logIndex].every(quantity)) fail();
    if (BigInt(r.blockNumber) < BigInt(p.indexedFrom) || BigInt(r.blockNumber) > BigInt(p.sourceBlockNumber) || (r.blockNumber === p.sourceBlockNumber && r.blockHash !== p.sourceBlockHash)) fail();
    if (last && last.blockNumber === r.blockNumber && (last.blockHash !== r.blockHash || (last.transactionIndex === r.transactionIndex && last.transactionHash !== r.transactionHash))) fail();
    if (r.id !== `${chain}:${r.blockHash}:${r.transactionHash}:${r.logIndex}:${account}` || seen.has(r.id) || (last && !earlier(last, r))) fail();
    if (typeof r.module !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,127}$/.test(r.module) || typeof r.signature !== 'string' || r.signature.length > 1024 || !/^[A-Za-z][A-Za-z0-9]*\([^()]*\)$/.test(r.signature) || !Array.isArray(r.roles) || r.roles.length < 1 || r.roles.length > 3 || r.roles.some((role, i) => typeof role !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(role) || (i > 0 && role <= r.roles[i - 1]!))) fail();
    if (!r.arguments || typeof r.arguments !== 'object' || Array.isArray(r.arguments) || Object.keys(r.arguments).length > 32 || Object.values(r.arguments).some(v => typeof v !== 'boolean' && (typeof v !== 'string' || v.length > 1024))) fail();
    for (const role of r.roles) { if (r.arguments[role] !== account) fail(); }
    seen.add(r.id); last = r;
  }
  return p;
}
