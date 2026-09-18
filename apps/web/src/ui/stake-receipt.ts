import {decodeEventLog, type Abi, type Address, type Hex} from 'viem';

export type StakeReceiptAction = 'stake' | 'unstakeAndWithdraw' | 'rageQuit';

export type StakeReceiptRequest = {
  vault: Address;
  assetUid: Hex;
  marketId: Hex;
  account: Address;
  action: StakeReceiptAction;
  stakeAmount?: bigint;
  /** Optional transaction destination, such as the AllocationManager. */
  target?: Address;
  /** Pass the generated UserStockVault ABI from a lazy import. */
  abi: Abi;
};

type ReceiptForStake = {
  status: 'success' | 'reverted';
  from: Address;
  to: Address | null;
  logs: readonly {address: Address; data: Hex; topics: [] | [Hex, ...Hex[]]}[];
};

type PrincipalEvent = {
  eventName: 'StockDeposited' | 'StockWithdrawn' | 'AllocationLocked' | 'AllocationReleased' | 'AllocationRageQuit';
  args: Record<string, unknown>;
};

/**
 * Attributes principal to events emitted by the canonical UserStockVault in
 * this successful transaction receipt. It deliberately does not inspect a
 * block's logs or compare balances before and after the transaction.
 */
export function verifyStakeReceipt(receipt: ReceiptForStake, request: StakeReceiptRequest): bigint {
  const account = request.account.toLowerCase();
  const vault = request.vault.toLowerCase();
  if (receipt.status !== 'success') throw new Error('Stake transaction receipt is not successful');
  if (receipt.from.toLowerCase() !== account) throw new Error('Stake receipt sender does not match the account');
  if (request.target && receipt.to?.toLowerCase() !== request.target.toLowerCase()) {
    throw new Error('Stake receipt target does not match the expected contract');
  }
  if (request.action === 'stake' && (request.stakeAmount === undefined || request.stakeAmount <= 0n)) {
    throw new Error('Stake amount must be provided and greater than zero');
  }

  const events: PrincipalEvent[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== vault) continue;
    try {
      const decoded = decodeEventLog({abi: request.abi, data: log.data, topics: log.topics});
      if (
        decoded.eventName === 'StockDeposited' || decoded.eventName === 'StockWithdrawn' ||
        decoded.eventName === 'AllocationLocked' || decoded.eventName === 'AllocationReleased' ||
        decoded.eventName === 'AllocationRageQuit'
      ) {
        events.push({eventName: decoded.eventName, args: decoded.args as unknown as Record<string, unknown>});
      }
    } catch {
      // A receipt can include unrelated Vault logs. Only valid, relevant events count.
    }
  }

  const matches = (eventName: PrincipalEvent['eventName'], needsMarket: boolean) => events.filter(event => {
    const args = event.args;
    return event.eventName === eventName &&
      typeof args.assetUid === 'string' && args.assetUid.toLowerCase() === request.assetUid.toLowerCase() &&
      typeof args.user === 'string' && args.user.toLowerCase() === account &&
      (!needsMarket || (typeof args.marketId === 'string' && args.marketId.toLowerCase() === request.marketId.toLowerCase()));
  });

  const exactlyOne = (eventName: PrincipalEvent['eventName'], needsMarket: boolean): bigint => {
    const found = matches(eventName, needsMarket);
    if (found.length !== 1) throw new Error(`Expected exactly one canonical ${eventName} event for this action`);
    const amount = found[0]!.args.amount;
    if (typeof amount !== 'bigint') throw new Error(`Canonical ${eventName} amount is invalid`);
    return amount;
  };

  if (request.action === 'stake') {
    const deposited = exactlyOne('StockDeposited', false);
    const locked = exactlyOne('AllocationLocked', true);
    if (deposited !== locked || deposited !== request.stakeAmount) {
      throw new Error('Stake receipt principal events do not match the requested amount');
    }
    return deposited;
  }

  const allocationEvent = request.action === 'unstakeAndWithdraw' ? 'AllocationReleased' : 'AllocationRageQuit';
  const released = exactlyOne(allocationEvent, true);
  const withdrawn = exactlyOne('StockWithdrawn', false);
  if (released <= 0n || released !== withdrawn) {
    throw new Error('Withdrawal receipt principal events do not match');
  }
  return released;
}
