# Libraries

V2-only libraries whose math and state invariants have passed the matching specification gate.

`PonsSupplyMath.sol` implements full-precision initial supply partitioning, graduation pool/excess partitioning, and balance-independent tracked reserve views. It rejects zero, degenerate, overflowing, below-reserve, and fee-over-accrual states rather than silently substituting live token balances.

`PonsCurveMath.sol` is the single pure quote path for Pons-compatible exact-input/output constant-product math. It preserves the mandatory exact-output `floor + 1`, independently floors both Quote fee legs, prices buys after fees and sells before fees, and computes tail fill/refund plus proportional slippage with full-width product comparison. Runtime fee selection, transfers, state mutation, and reentrancy protection remain responsibilities of the concrete Curve.

`PonsAntiSnipe.sol` freezes the observed three-second runtime lookup table instead of fitting an unverified decay formula. It applies the fixed 100 bps minimum-net clip, keeps creator tax at zero, derives the buy-only fee through `PonsCurveMath`, and recognizes only the frozen creator, creation-time beneficiary, or an authenticated Launch Router's atomic first-buy recipient.
