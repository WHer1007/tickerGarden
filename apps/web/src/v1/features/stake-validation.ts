const MAX_UINT256 = (1n << 256n) - 1n;
export function validateMarketStake(amount_: bigint, walletBalance: bigint, currentStake: bigint, minimum: bigint): void {
  if (amount_ <= 0n || amount_ > MAX_UINT256) throw new TypeError("amount must be a positive uint256");
  if (walletBalance < 0n || currentStake < 0n || minimum <= 0n) throw new TypeError("invalid staking state");
  if (amount_ > walletBalance) throw new RangeError("Stake exceeds your wallet STOCK balance");
  if (currentStake + amount_ > MAX_UINT256) throw new RangeError("Total stake exceeds uint256");
  if (currentStake + amount_ < minimum) throw new RangeError("Resulting stake is below the market minimum");
}
