# Libraries

V1-only libraries whose math and state invariants have passed the matching specification gate.

`TickerGardenSupplyMath.sol` implements full-precision initial supply partitioning, graduation pool/excess partitioning, and balance-independent tracked reserve views. It rejects zero, degenerate, overflowing, below-reserve, and fee-over-accrual states rather than silently substituting live token balances.

`TickerGardenCurveMath.sol` is the single pure quote path for TickerGarden exact-input/output constant-product math. It preserves the mandatory exact-output `floor + 1`, independently floors both Quote fee legs, prices buys after fees and sells before fees, and computes tail fill/refund plus proportional slippage with full-width product comparison. Runtime fee selection, transfers, state mutation, and reentrancy protection remain responsibilities of the concrete Curve.

`TickerGardenAntiSnipe.sol` implements the project-approved five-second lookup table (9900/2475/309/19/1 bps, then zero); archived three-second external observations remain separate historical evidence. It applies the fixed 100 bps minimum-net clip, retains a zero-tax reference quote helper; the product Curve clips with base fee plus creator tax and computes each fee leg independently through `TickerGardenCurveMath`, and recognizes only the frozen creator, creation-time beneficiary, or an authenticated Launch Router's atomic first-buy recipient.
