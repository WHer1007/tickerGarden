import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { keccak_256 } from '../../deployments/node_modules/@noble/hashes/sha3.js';

const hash = bytes => '0x' + Buffer.from(keccak_256(bytes)).toString('hex');
const bytes = hex => Buffer.from(hex.slice(2), 'hex');
const zero = '0x' + '0'.repeat(40);
const dead = '0x' + '0'.repeat(36) + 'dead';
function hex(value, length) {
  if (typeof value !== 'string' || !new RegExp('^0x[0-9a-fA-F]{' + length * 2 + '}$').test(value)) throw Error('Invalid hex');
  return value.toLowerCase();
}
function uint(value, bits = 256) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error('Integers must be canonical decimal strings');
  const n = BigInt(value);
  if (n >= 1n << BigInt(bits)) throw Error('Integer overflow');
  return n;
}
const word = n => n.toString(16).padStart(64, '0');
const addrWord = a => a.slice(2).padStart(64, '0');
const pair = (a, b) => hash(Buffer.concat([bytes(a < b ? a : b), bytes(a < b ? b : a)]));
const domain = hash(Buffer.from('TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_LEAF_V1'));

/** Offline independent reference input only. Does not fetch balances, attest finality, sign or publish. */
export function buildWalletSnapshot(reference) {
  const chainId = uint(reference.chainId);
  if (chainId === 0n) throw Error('Invalid chain');
  const distributor = hex(reference.distributor, 20), marketId = hex(reference.marketId, 32);
  if (distributor === zero || BigInt(marketId) === 0n) throw Error('Missing deployment identity');
  const snapshotBlock = uint(reference.snapshotBlock, 64), round = uint(reference.round, 64);
  const snapshotBlockHash = hex(reference.snapshotBlockHash, 32);
  if (BigInt(snapshotBlockHash) === 0n || round !== uint(reference.lastRound, 64) + 1n ||
      snapshotBlock <= uint(reference.lastSnapshotBlock, 64) ||
      snapshotBlock < uint(reference.registeredBlock, 64) ||
      snapshotBlock > uint(reference.finalizedBlock, 64)) throw Error('Invalid round/block boundary');
  const quoteTarget = uint(reference.quoteTarget), memeTarget = uint(reference.memeTarget);
  if (quoteTarget > uint(reference.unallocatedQuote) || memeTarget > uint(reference.unallocatedMeme)) throw Error('Unfunded budget');
  if (!Array.isArray(reference.excluded) || !Array.isArray(reference.balances)) throw Error('Missing independent reference data');
  const excluded = new Set([zero, dead, distributor, ...reference.excluded.map(a => hex(a, 20))]);
  for (const key of ['token','curve','poolManager','locker','vault','hook']) {
    const account = hex(reference[key], 20);
    if (account === zero || !excluded.has(account)) throw Error('Missing protocol exclusion: ' + key);
  }
  const seen = new Set();
  const balances = reference.balances.map(row => {
    const account = hex(row.account, 20);
    if (seen.has(account)) throw Error('Duplicate account');
    seen.add(account);
    return { account, balance: uint(row.balance).toString() };
  }).sort((a,b) => a.account.localeCompare(b.account));
  if (balances.reduce((sum,row) => sum + BigInt(row.balance),0n) !== uint(reference.totalSupply)) throw Error('Incomplete supply reconciliation');
  const eligible = balances.filter(row => !excluded.has(row.account) && BigInt(row.balance) > 0n);
  const total = eligible.reduce((s,r) => s + BigInt(r.balance), 0n);
  if (total === 0n) throw Error('No eligible wallet balance');
  // Canonical source digest: all supplied balances, including excluded accounts, and the exclusion policy.
  const dataHash = hash(Buffer.from(JSON.stringify({
    chainId: chainId.toString(), distributor, marketId, snapshotBlock: snapshotBlock.toString(),
    snapshotBlockHash, excluded: [...excluded].sort(), balances,
    quoteTarget: quoteTarget.toString(), memeTarget: memeTarget.toString()
  })));
  const leaves = eligible.map(row => {
    const q = BigInt(row.balance) * quoteTarget / total, m = BigInt(row.balance) * memeTarget / total;
    const inner = hash(Buffer.from(domain.slice(2) + word(chainId) + addrWord(distributor) +
      marketId.slice(2) + word(round) + addrWord(row.account) + word(q) + word(m), 'hex'));
    return {account:row.account, quoteAmount:q.toString(), memeAmount:m.toString(), leaf:hash(bytes(inner))};
  }).filter(row => BigInt(row.quoteAmount) + BigInt(row.memeAmount) > 0n).sort((a,b) => a.leaf.localeCompare(b.leaf));
  if (leaves.length === 0) throw Error('Budget rounds to zero');
  const layers = [leaves.map(row => row.leaf)];
  while (layers.at(-1).length > 1) {
    const last = layers.at(-1), next = [];
    for (let i=0; i<last.length; i+=2) next.push(i+1 < last.length ? pair(last[i],last[i+1]) : last[i]);
    layers.push(next);
  }
  const claims = leaves.map((row, index) => {
    let i=index; const proof=[];
    for (let level=0; level<layers.length-1; level++) {
      const sibling = i ^ 1;
      if (sibling < layers[level].length) proof.push(layers[level][sibling]);
      i=Math.floor(i/2);
    }
    return {...row, proof};
  });
  return {chainId:chainId.toString(),distributor,marketId,round:round.toString(),
    snapshotBlock:snapshotBlock.toString(),snapshotBlockHash,root:layers.at(-1)[0],dataHash,
    quoteBudget:leaves.reduce((s,r)=>s+BigInt(r.quoteAmount),0n).toString(),
    memeBudget:leaves.reduce((s,r)=>s+BigInt(r.memeAmount),0n).toString(), claims};
}

/** Compare a proposed payload against independently supplied indexed wallet balances; fail closed. */
export function validateWalletPublication(proposed, reference) {
  const expected = buildWalletSnapshot(reference);
  for (const key of ['chainId','distributor','marketId','round','snapshotBlock','snapshotBlockHash','root','dataHash','quoteBudget','memeBudget']) {
    if (proposed[key] !== expected[key]) throw Error('Publication mismatch: ' + key);
  }
  return expected;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [referencePath, proposedPath] = process.argv.slice(2);
  if (!referencePath || !proposedPath) throw Error('Usage: node wallet-snapshot-preflight.mjs independent-reference.json proposed-publication.json');
  const result = validateWalletPublication(JSON.parse(readFileSync(proposedPath,'utf8')), JSON.parse(readFileSync(referencePath,'utf8')));
  process.stdout.write(JSON.stringify({status:'OFFLINE_REFERENCE_MATCH_ONLY',...result},null,2)+'\n');
}
