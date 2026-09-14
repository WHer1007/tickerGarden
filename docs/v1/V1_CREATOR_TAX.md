# Creator tax — 5% maximum

Updated 2026-09-05. Implemented for the development release; no deployment performed.

## Product rule

The creator selects 0–5% in 0.01% increments (0–500 integer basis points), default 0.
The Factory validates the cap and freezes the rate in MarketConfig and the curve.
The rate is part of the current expectedEconomics commitment, so changing it invalidates a prior
creation preview. There is no post-launch tax-rate setter.

Creator tax is an additional fee, not a share of the existing fixed trading fee.
It is 100% credited to the creator revenue epoch through ProtocolFeeVault and
claimed using the existing creator claim flow, regardless of the holder-sharing
choice. When the immutable `creatorFeesToHolders` choice is enabled, exactly 50%
of the creator's base-fee share (excluding creator tax) is earmarked for holders;
the creator keeps the other 50% of that base-fee share. Existing platform/staker
splits remain unchanged. Changing the creator beneficiary follows the existing
revenue-epoch rules; it does not change the tax rate or transfer historical claims.

For example, with a 1% base fee and 5% creator tax on 100 quote units, 1 unit is
split using the existing base-fee rules, 5 units go entirely to the creator, and
94 units enter the curve. The creator may also receive their existing base-fee share.

## Charging and accounting

- Curve buy: base fee, creator tax and temporary anti-snipe fee each round down
  independently on actual quote spent. Net quote enters the curve; fees do not
  increase the graduation reserve. Partial fills only tax the spent amount and
  refund the rest. Anti-snipe clips after base fee plus creator tax to preserve
  the existing minimum 1% net. Anti-snipe exemptions do not exempt creator tax.
- Curve sell: base fee and creator tax independently round down on gross quote
  output. The seller receives gross minus both. quoteSell returns the net output
  and combined fee; execution uses the same calculation and minimum-output check.
- Curve sweep: total fee and creatorTaxAmount are bound into the fee ID and the
  atomic begin/finalize balance proof. Only total minus creator tax is split;
  the full tax is added to creator liabilities. Graduation sweeps both legs.
- Graduated v4 Hook: base = absolute unspecified core swap delta. Total hook fee
  is floor(base × 100 / 10000) + floor(base × creatorTaxBps / 10000).
  Exact-input swaps deduct it from output; exact-output swaps add it to input.
  The vault independently recomputes total and splits only the base-fee leg.
- Atomic developer buy: create and buy remain one transaction, including creator
  tax. Slippage failure or transfer failure rolls back creation and purchase.

## Pons reference and deliberate project differences

Primary source snapshot: [ponsfamily commit 845bd546](https://github.com/ponsdotdev/ponsfamily/tree/845bd546b37515621e47b08015ce4f9d374f6eca).
[Curve source](https://github.com/ponsdotdev/ponsfamily/blob/845bd546b37515621e47b08015ce4f9d374f6eca/contractsV2/src/v2/PonsV2BondingCurve.sol),
[Factory source](https://github.com/ponsdotdev/ponsfamily/blob/845bd546b37515621e47b08015ce4f9d374f6eca/contractsV2/src/v2/PonsV2LaunchFactory.sol),
and [Hook source](https://github.com/ponsdotdev/ponsfamily/blob/845bd546b37515621e47b08015ce4f9d374f6eca/contractsV2/src/v2/hooks/PonsV2MemeHook.sol).

Pons caps creator tax at 1000 bps; TickerGarden uses an immutable 500 bps maximum.
Both independently floor base fee and tax, and pay all creator tax to the creator.
Pons can convert meme-denominated Hook receipts to quote internally. Current TickerGarden
UserClaims pays the selected original Quote/Meme assets without internal conversion,
a conversion deadline, or a delayed original-token fallback. Staker locks still apply;
markets with `burnMemeFees` burn Meme fees according to their frozen configuration.
The holder-sharing preference affects only the creator's base-fee share and never
creator tax or historical beneficiary ownership. The [older reward conversion document](V1_REWARD_CONVERSION.md)
is retained only as evidence of its named historical release.
The reference is a source-code comparison, not verification of live deployed values.

## Integration

CreateMarketParams and MarketConfig append uint16 creatorTaxBps. Curve initialization
includes the rate. The canonical ABI, expected-economics vectors, web transaction
builder and metadata validation are updated. Nonzero tax is now permitted by the
web form; runtime write readiness and whitelist activation checks still apply.
Metadata mirrors the choice for presentation, while the on-chain snapshot is authoritative.
These changed tuples and code hashes require a coordinated new development deployment;
old deployments must not be used with the new ABI. This document is not release evidence.

## Historical creator-tax validation before reward conversion

- Product/shared/deployment contract regression: 688 passed, zero failures.
- Final Factory suite after the additional taxed ERC20 rollback test: 59 passed.
- Focused suites include Curve 23, Hook fee calculation 15, V4 fee accounting 17,
  and Curve credit 14 passing tests.
- Specification 62, frontend 48 and backend 21 tests passed.
- Frontend and all offchain TypeScript builds passed. Generated interface, canonical
  ABI and product artifact checks passed.
- Desktop/mobile Create interaction checks passed on the production build.
  The external Google Fonts request was blocked in the QA harness after CDN load
  timeouts; this uses fallback fonts only for testing, without changing product styles.
- No deployment or chain transaction was performed.
