# Trade payment conversion

Implemented 2026-09-17 in the alignment worktree. Not deployed by this change.

## Behavior

- Buy with the paired asset directly; Growing uses the existing curve, Bloomed uses the existing canonical pool route.
- Mainnet ETH pairs also offer USDG; USDG pairs also offer ETH; supported Stock pairs offer their Stock, USDG and ETH. Testnet retains direct paired-asset trading because this integration is chain 4663 only.
- Non-pair payments use server-quoted 0x AllowanceHolder v2 conversion followed by the existing project buy. Fixed payment amount, no automatic spend increase. No new production contracts.
- The user approved 1% conversion tolerance. Confirmation shows both the conversion minimum and the final project-token minimum quoted at that conversion floor. Refresh can tighten, never lower, the accepted minimum. Direct paired-asset Trade protection is unchanged; Developer Buy's 10% ETH allowance is unrelated.
- Quoted provider fees are displayed separately and already included in conversion output. Market price impact is distinguished from conversion impact; absent conversion impact is shown as `-`, not fabricated.
- Wallet may require ERC-20 approval and separate transaction signatures. Failed second legs retain assets. Positive surplus above the reviewed amount remains in the wallet.
- Conversion and project-buy states are persisted separately, including submitted hashes. Wallet, market and chain scopes are isolated. Startup receipt reconciliation clears completed buys rather than offering them again. Unknown transactions remain paused; no automatic replay. A no-hash cancelled request requires explicit wallet-history review before reset.

## Validation

- Web typecheck, production build, generated data, ABI/client boundaries, performance budgets and SEO checks pass.
- Backend typecheck, unit tests, API contract coverage and Vercel packaging checks pass.
- Read-only provider probes: ETH → USDG and USDG → ETH returned executable quotes.
- Mainnet fork block 65397551: official Settler registration checked; ETH → USDG executed; Factory-created USDG market bought using converted assets; deliberately reverting second leg retained assets and succeeded on retry; USDG → ETH executed. Only local fork transactions were sent.
- Fork evidence: `outputs/reviews/trade-conversion/fork-65397551.json`; reproducible script: `tools/research/verify-trade-conversion-fork.mjs`.
- The newly added conversion flow has not been exercised through a real wallet/browser or a live Bloomed market. Existing pool path tests remain green. No real user funds were spent.

## Release prerequisite

`ZEROX_API_KEY` must be configured on Read API only. The existing local key was found without exposing its value. Do not use a `VITE_` variable for it.

Stock probe `0xd95b44124e475743a7589e68f3d74008a5536d44` returned HTTP 422 `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE` from 0x. ETH/ USDG support does not establish Stock access. The provider must confirm/enable the account's applicable tokenized-equity permissions before Stock conversion can be accepted. Direct paired-asset trading remains available. No attempt was made to bypass the restriction or silently substitute another provider.

Deploy Read API before Web, from the correct environment branch, using `--regions sin1`, source/runtime boundary checks, and runtime region verification before alias/promotion. Production release remains separate from this implementation request.
