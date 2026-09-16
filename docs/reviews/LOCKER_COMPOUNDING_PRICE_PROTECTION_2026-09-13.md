# Locker compounding: price-protection decision

Status: historical design review; the user subsequently approved the Keeper-only revision. See `docs/v1/LOCKER_FEE_COMPOUNDING.md` for the implemented candidate. Not deployed.

The earlier recommendation to allow unrestricted callers to compound at the current pool price was incomplete. Fixed NFT/pool custody prevents withdrawals but does not prevent price manipulation before liquidity is added. Calculating minimum liquidity from the same manipulable spot price within the transaction does not provide an independent execution bound. Caller-provided limits also do not protect protocol-owned funds when arbitrary callers can choose them.

Evidence: vendored `contracts/lib/v4-periphery/src/PositionManager.sol` explicitly warns that `_increaseFromDeltas` is vulnerable to sandwich attacks and recommends explicit `_increase` liquidity. [Uniswap Position Manager source](https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol). Explicit liquidity alone is insufficient if an arbitrary caller can lower it or choose the reference price.

Recommended revision for approval:

- Anyone can collect the bound NFT's fees into its Locker, without reducing principal or paying an external recipient.
- Compounding is triggered by a governance-designated ordinary Keeper wallet. No multisig approval is required per transaction.
- The Keeper prepares fixed liquidity and per-currency maximum inputs with a short deadline, simulates, checks recent price behavior and submits. Contract verifies authorized caller, immutable pool/NFT/range, bounded spends, exact liquidity increase, ownership, allowance cleanup and retained remainders.
- No swaps, token/NFT withdrawals, alternate recipients or arbitrary calls. Additional liquidity stays permanently locked.
- Governance can replace the Keeper. Keeper downtime affects compounding only, never swaps/transfers.
- Keeper compromise or bad pricing remains an economic risk; its lack of withdrawal rights does not eliminate this risk. Permissionless execution with an independent price guard instead requires an additional oracle design and associated trust/freshness rules.

This changed the earlier unrestricted-trigger authorization model. The user approved this revision before implementation.
