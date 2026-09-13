> PAUSED: Locker fee collection and compounding are documented separately and are not active. No LP fee changes are included in the Meme fee burn release.

# Creator-selected optional v4 LP fee

Status: upcoming new-release product documentation. This document records the
planned rule and is not deployment, activation, or live-chain evidence.

## Creation choice

The Create flow will expose the setting under **Advanced** as an optional
static v4 LP fee:

- Advanced toggle off: `0%`;
- Advanced toggle on: choose exactly `0.1%`, `0.2%`, or `0.3%`.

The selected value is frozen when the market is created. There is no later
setter or adjustment for an existing market.

## Scope and fee relationship

The selected LP fee applies only after the market graduates to its canonical
v4 pool. It is an additional pool fee alongside the existing protocol fee and
creator tax; it does not replace, reduce, or alter either one. The creator tax
remains the separate creator charge described in
[`V1_CREATOR_TAX.md`](./V1_CREATOR_TAX.md).

This fee is native active LP reward accrual from the v4 pool. It is not a
FeeVault credit, is not part of the protocol fee split, and does not become a
creator, holder, staker, or platform claim balance through FeeVault.

## Canonical graduation locker

The canonical graduation `LaunchLocker` remains permanently locked. The
optional creator-selected LP fee toggle is still a separate upcoming feature;
the current pool fee remains `0%`. The candidate locker fee path is documented in
[`LOCKER_FEE_COMPOUNDING.md`](./LOCKER_FEE_COMPOUNDING.md), but it is not active
or deployed.

This rule describes the upcoming release behavior only. No deployment or live
execution claim follows from this document.
