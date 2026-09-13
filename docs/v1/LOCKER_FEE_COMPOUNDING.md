# LaunchLocker LP fee collection and compounding

Status: implemented in the candidate contracts; deployment is pending. The backend does not currently run an automatic trigger, and this
document is not live-chain evidence.

`LaunchLocker` remains the permanent owner of the original v4 position. LP
fees are separate from FeeVault accounting and from Meme fee burn: they are
fees accrued by that locked position in the pool.

## Two transaction paths

Anyone may call `collectLockedFees()` for the bound position. Collection sends
the fees to the same Locker and cannot send principal or fees to an external
recipient. A failed collection does not block trading.

Only the governance-designated global Keeper may call
`compoundLockedFees(liquidity, amount0Max, amount1Max, deadline)` on each Locker.
Governance sets the shared Keeper on GraduationExecutor with `setCompoundKeeper(address)`;
setting the zero address disables compounding. There is no deployer default.
The Keeper is an ordinary operational signer, and the backend-triggered
automation is future work rather than a live service.

The contract binds the operation to the original NFT, pool and tick range.
The call uses explicit liquidity and per-currency maximum inputs with a short
deadline (at most five minutes from execution). It performs no swaps, does not reduce liquidity, cannot withdraw the
NFT or tokens, and cannot choose another recipient or arbitrary call. Any
temporary approvals are cleared. The Keeper’s bounded pricing inputs reduce
execution exposure, but do not provide an absolute anti-sandwich guarantee;
Keeper pricing is trusted within those transaction bounds.

Before a compound attempt sends the native compounding funds, the same Locker
transaction must use a separate PositionManager call to `SWEEP` both currency
balances already present in PositionManager, including unrelated transfers, into the Locker. Those
two-currency sweep balances are isolated accounting balances: they cannot be
used as compounding input, cannot be counted as `pendingCompoundFees`, and may
not be reduced by a later operation. Only after this sweep step may the call
send the native funds for the current compounding attempt.

## Accounting boundary

The contract tracks collected LP fees separately. Compounding can spend only
those collected fees and their retained remainders from prior bounded
attempts. It excludes direct donations, graduation excess, original-position
principal, and the isolated sweep balances described above. `pendingCompoundFees`
is a bookkeeping balance, not a statement that all of that amount is currently
spendable.

When the Locker has a historical shortfall, collection is still allowed through
an independent `collectLockedFees()` call. For each currency, newly collected
fees first repair the historical shortfall; only the remainder is credited to
`pendingCompoundFees`. Historical isolated balances are never lowered, including
during a repair: incoming fees restore actual coverage rather than reducing the
accounting floor. The return values
from collection and the `LockedFeesCollected` event report the actual total
collected for both currencies, including the portion used to repair the
shortfall. The event and return values do not report only the amount newly
available for compounding.

Any remaining shortfall in either currency prevents `compoundLockedFees` from
running, even if `pendingCompoundFees` is nonzero. An independent collection
may preserve a partial repair when only some of the shortfall is covered. If a
compound call performs its internal collection and the compound later fails,
the internal collection and all of its accounting changes revert atomically;
no partial repair or pending-fee credit survives that failed compound
transaction.

If a collected amount does not match the requested bounds, the unmatched
remainder stays in the Locker for a later attempt. A failed compounding
transaction does not block swaps or transfers.

Any resulting liquidity is added back to the same permanently locked NFT,
pool, and range. There is no user withdrawal or FeeVault claim for this LP
fee balance.


## Governance and operations

The generated AccessManager plan binds `GraduationExecutor.setCompoundKeeper` to
PROTOCOL_ADMIN_ROLE, with the existing 48-hour execution delay. The governance
Safe schedules and executes rotation through AccessManager. No multisig action is
needed for individual compounding transactions. A zero Keeper disables compounding,
while fee collection and trading remain available. No Keeper wallet has been configured
or funded by this implementation task.

Before execution, the backend must verify the canonical Locker and deployed code,
read current fee balances and pool price, choose explicit liquidity and input limits,
simulate from the Keeper address, and submit within the deadline. It should skip small
balances, serialize transactions per Keeper, and reconcile receipts before retrying.
Scheduling and production signer integration remain an operational TODO, not an
enabled job. Existing zero-LP-fee pools do not generate swap LP fees merely because
this entry point exists; enabling optional LP fees is a separate release change.
