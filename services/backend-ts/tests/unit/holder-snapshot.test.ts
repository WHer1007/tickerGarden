import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';
import { buildSnapshot, proofRoot, snapshotLeaf, verifySnapshot, type SnapshotInput } from '../../packages/chain/src/holder-snapshot.ts';

const h = (c: string) => `0x${c.repeat(64)}` as Hex;
const a = (c: string) => `0x${c.repeat(40)}` as Address;
const distributor = a('d');
const token = a('e');
const quote = a('f');
const marketId = h('1');
const exclusions = [a('0'), distributor, token] as const;
function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return { chainId: 46630, deploymentDigest: h('a'), distributor, marketId, token, quote,
    round: '1', snapshotBlock: '200', snapshotBlockHash: h('b'), registeredBlock: '100', lastSnapshotBlock: '150',
    totalSupply: '100', quoteAvailable: '10', memeAvailable: '7', burnMemeFees: false, exclusions,
    balances: [{account:a('1'), balance:'10'}, {account:a('2'), balance:'20'}, {account:a('3'), balance:'70'}], ...overrides };
}

test('leaf encoding is compatible with the web implementation and proofs verify', () => {
  const ds = buildSnapshot(input());
  const domain = keccak256(toHex('TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_LEAF_V1'));
  const encoded = encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'bytes32'},{type:'uint64'},{type:'address'},{type:'uint256'},{type:'uint256'}],
    [domain, 46630n, distributor, marketId, 1n, a('1'), 1n, 0n]);
  assert.equal(ds.entries[0]!.quoteAmount, '1');
  assert.equal(snapshotLeaf(46630, distributor, marketId, '1', a('1'), '1', '0'), keccak256(keccak256(encoded)));
  for (const entry of ds.entries) assert.equal(proofRoot(snapshotLeaf(46630, distributor, marketId, '1', entry.account, entry.quoteAmount, entry.memeAmount), entry.proof), ds.root);
});

test('odd sized trees promote the final node and preserve valid proofs', () => {
  const ds = buildSnapshot(input({ balances: [{account:a('1'),balance:'10'},{account:a('2'),balance:'20'},{account:a('3'),balance:'70'}], totalSupply:'100', quoteAvailable:'100', memeAvailable:'0' }));
  assert.equal(ds.entries.length, 3);
  assert.equal(ds.entries[2]!.proof.length, 1);
  for (const e of ds.entries) assert.equal(proofRoot(snapshotLeaf(46630, distributor, marketId, '1', e.account, e.quoteAmount, e.memeAmount), e.proof), ds.root);
});

test('rounding never exceeds either funding budget and exclusions are omitted', () => {
  const ds = buildSnapshot(input({ totalSupply:'103', balances:[{account:a('1'),balance:'1'},{account:a('2'),balance:'1'},{account:distributor,balance:'1'},{account:a('3'),balance:'100'}], quoteAvailable:'5', memeAvailable:'5' }));
  assert.ok(!ds.entries.some(e => e.account === distributor));
  assert.ok(BigInt(ds.quoteBudget) <= 5n && BigInt(ds.memeBudget) <= 5n);
  assert.equal(ds.eligibleSupply, '102');
});

test('rejects duplicate holders, supply or funding errors, and burn-mode meme funding', () => {
  assert.throws(() => buildSnapshot(input({ balances:[{account:a('1'),balance:'50'},{account:a('1'),balance:'50'}] })), /duplicate/);
  assert.throws(() => buildSnapshot(input({ totalSupply:'99' })), /supply mismatch/);
  assert.throws(() => buildSnapshot(input({ quoteAvailable:'x' })), /invalid snapshot integer/);
  assert.throws(() => buildSnapshot(input({ burnMemeFees:true, memeAvailable:'1' })), /burn-mode/);
});

test('verifySnapshot rejects a corrupted dataset', () => {
  const ds = buildSnapshot(input());
  const corrupted = structuredClone(ds);
  corrupted.entries[0]!.quoteAmount = '2';
  assert.throws(() => verifySnapshot(corrupted), /integrity mismatch/);
});
