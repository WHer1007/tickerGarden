import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hex} from 'viem';
import {verifyStakeReceipt} from '../src/ui/stake-receipt.ts';

const abi = parseAbi([
  'event StockDeposited(bytes32 indexed assetUid, address indexed user, uint256 amount)',
  'event StockWithdrawn(bytes32 indexed assetUid, address indexed user, uint256 amount)',
  'event AllocationLocked(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount, uint256 userMarketAllocation, uint256 userTotalAllocated)',
  'event AllocationReleased(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount, uint256 userMarketAllocation, uint256 userTotalAllocated)',
  'event AllocationRageQuit(bytes32 indexed assetUid, address indexed user, bytes32 indexed marketId, uint256 amount)',
]);
const vault = '0x1111111111111111111111111111111111111111' as Address;
const otherVault = '0x2222222222222222222222222222222222222222' as Address;
const account = '0x3333333333333333333333333333333333333333' as Address;
const otherAccount = '0x4444444444444444444444444444444444444444' as Address;
const target = '0x5555555555555555555555555555555555555555' as Address;
const assetUid = `0x${'a'.repeat(64)}` as Hex;
const otherAssetUid = `0x${'b'.repeat(64)}` as Hex;
const marketId = `0x${'c'.repeat(64)}` as Hex;
const otherMarketId = `0x${'d'.repeat(64)}` as Hex;

function log(eventName: string, args: Record<string, unknown>, amount: bigint, address = vault) {
  const topics = encodeEventTopics({abi, eventName: eventName as never, args: args as never}) as [Hex, ...Hex[]];
  const data = eventName === 'AllocationLocked' || eventName === 'AllocationReleased'
    ? encodeAbiParameters([{type: 'uint256'}, {type: 'uint256'}, {type: 'uint256'}], [amount, amount, amount])
    : encodeAbiParameters([{type: 'uint256'}], [amount]);
  return {address, data, topics};
}

function stakeLogs(options: {amount?: bigint; lockedAmount?: bigint; user?: Address; uid?: Hex; market?: Hex; vaultAddress?: Address} = {}) {
  const amount = options.amount ?? 120n;
  const common = {assetUid: options.uid ?? assetUid, user: options.user ?? account};
  return [
    log('StockDeposited', common, amount, options.vaultAddress),
    log('AllocationLocked', {...common, marketId: options.market ?? marketId}, options.lockedAmount ?? amount, options.vaultAddress),
  ];
}

function receipt(logs: ReturnType<typeof log>[], overrides: Record<string, unknown> = {}) {
  return {status: 'success', from: account, to: target, logs, ...overrides} as unknown as {
    status: 'success' | 'reverted'; from: Address; to: Address; logs: ReturnType<typeof log>[];
  };
}

const request = (overrides: Record<string, unknown> = {}) => ({
  vault, assetUid, marketId, account, action: 'stake' as const, stakeAmount: 120n, target, abi,
  ...overrides,
});

test('stake principal is attributed to matching events in this receipt', () => {
  // Same-block unrelated protocol/user logs do not count toward this account's action.
  const logs = [
    log('StockDeposited', {assetUid, user: otherAccount}, 120n),
    log('AllocationLocked', {assetUid, user: account, marketId: otherMarketId}, 120n),
    ...stakeLogs(),
    log('StockDeposited', {assetUid, user: account}, 120n, otherVault),
  ];
  assert.equal(verifyStakeReceipt(receipt(logs), request()), 120n);
});

test('rejects failed status, sender mismatch, target mismatch, and wrong market', () => {
  const valid = receipt(stakeLogs());
  assert.throws(() => verifyStakeReceipt({...valid, status: 'reverted'} as never, request()), /not successful/);
  assert.throws(() => verifyStakeReceipt({...valid, from: otherAccount} as never, request()), /sender/);
  assert.throws(() => verifyStakeReceipt({...valid, to: otherVault} as never, request()), /target/);
  assert.throws(() => verifyStakeReceipt(receipt(stakeLogs({market: otherMarketId})), request()), /AllocationLocked/);
});

test('rejects mismatched deposit, locked, or requested principal amounts', () => {
  assert.throws(() => verifyStakeReceipt(receipt(stakeLogs({amount: 119n})), request()), /requested amount/);
  assert.throws(() => verifyStakeReceipt(receipt(stakeLogs({lockedAmount: 119n})), request()), /requested amount/);
  assert.throws(() => verifyStakeReceipt(receipt(stakeLogs()), request({stakeAmount: 121n})), /requested amount/);
});

test('withdrawal and rage quit require matching positive vault principal events', () => {
  const amount = 300n;
  const released = [
    log('AllocationReleased', {assetUid, user: account, marketId}, amount),
    log('StockWithdrawn', {assetUid, user: account}, amount),
  ];
  assert.equal(verifyStakeReceipt(receipt(released), request({action: 'unstakeAndWithdraw', stakeAmount: undefined})), amount);

  const rageQuit = [
    log('AllocationRageQuit', {assetUid, user: account, marketId}, amount),
    log('StockWithdrawn', {assetUid, user: account}, amount),
  ];
  assert.equal(verifyStakeReceipt(receipt(rageQuit), request({action: 'rageQuit', stakeAmount: undefined})), amount);
  assert.throws(() => verifyStakeReceipt(receipt(rageQuit.slice(0, 1)), request({action: 'rageQuit'})), /StockWithdrawn/);
  assert.throws(() => verifyStakeReceipt(receipt([
    log('AllocationRageQuit', {assetUid, user: account, marketId}, amount),
    log('StockWithdrawn', {assetUid, user: account}, amount - 1n),
  ]), request({action: 'rageQuit'})), /do not match/);
  assert.throws(() => verifyStakeReceipt(receipt([
    log('AllocationReleased', {assetUid, user: account, marketId}, 0n),
    log('StockWithdrawn', {assetUid, user: account}, 0n),
  ]), request({action: 'unstakeAndWithdraw'})), /greater than zero|do not match/);
});

test('an event for another asset or vault cannot attribute this action', () => {
  const mismatchedAsset = stakeLogs({uid: otherAssetUid});
  assert.throws(() => verifyStakeReceipt(receipt(mismatchedAsset), request()), /StockDeposited/);
  const otherVaultLogs = stakeLogs({vaultAddress: otherVault});
  assert.throws(() => verifyStakeReceipt(receipt(otherVaultLogs), request()), /StockDeposited/);
});
