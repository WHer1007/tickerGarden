# Frontend field validation audit — 2026-09-08

Scope: active `apps/web`, including Create, Trade, Claim/Rewards, Markets filters and the dynamically inserted reward market loader. Historical archived frontends are excluded. No onchain transaction was submitted during validation.

The original frontend already parsed financial inputs before transactions, but inline feedback was inconsistent. This update adds shared field-level messages, `aria-invalid`, and `aria-describedby`; errors clear after correction, existing help IDs remain, and invalid submitted forms focus the first invalid field. Disabled/readonly controls and search filters are not incorrectly treated as transaction input. Existing wallet, canonical asset/market, balances, allowances, lock periods, quote expiry and transaction simulation checks remain authoritative.

| Page / fields | Input checks | Feedback / transaction guard |
|---|---|---|
| Create: Name | Required after trim, max 64 UTF-16 code units | Inline; checked again before launch / metadata upload |
| Create: Ticker | 1–16 A–Z/digits; lowercase converted to uppercase; illegal characters retained for correction | Inline; HTML pattern and launch parser |
| Description | Optional, max 1000 | Native length constraint; metadata service also validates |
| Token image | PNG/JPEG/WebP, nonempty, <=2 MB, image decode succeeds | Image status and custom validity; server decodes payload independently |
| X profile | Optional handle or HTTPS x.com/twitter.com profile, no credentials/query/hash/foreign domain | New inline validation consistent with metadata service |
| Website | Optional HTTP/HTTPS URL with hostname, no credentials | New inline validation plus HTML URL constraint |
| Paired asset / rewards Stock | Active config selection, staking Stock required only with staking enabled | Required/select state, create blocker and live registry checks |
| Developer buy | Optional blank/zero means no buy; unsigned plain decimal, asset precision, uint256 | Inline; current balance/quote/gas in preview and again before execution |
| Creator wallet | Optional uses connected wallet; otherwise nonzero 20-byte hex address | New inline validation and canonical address check |
| Creator tax | 0–5%, max 2 fractional digits | Inline + min/max/step + basis-point parser |
| Staking / holder sharing switches | Boolean; conditional fields updated by existing handlers | Existing immutable-choice explanations; no numeric/string coercion |
| Baseline/template/launch mode | Hidden protocol-controlled values | Canonical config checks before transaction, not editable user fields |
| Trade amount | Positive plain decimal, selected asset precision, uint256; text input avoids numeric coercion | New inline validation plus existing quote, balance and simulation checks |
| Slippage | Integer 0–5000 bps, no exponent notation | Inline, native bounds, accessible label and existing parser |
| Trade advanced market ID | Nonzero bytes32 | Required/pattern/accessible label + new inline message + registry check |
| Stake amount | Positive plain decimal with Stock precision, uint256 | New inline format error; existing preview checks wallet balance and minimum nonzero position |
| Reward market selectors | Canonical bytes32 and configured membership | Inline on interaction; existing selected market guard |
| Dynamic reward market ID / emergency market ID | Required nonzero bytes32 | Pattern + new inline error + canonical lookup |
| Settlement owner / new creator beneficiary | Required nonzero address | Pattern + new inline error + live transaction guards |
| Creator/holder epoch | Positive uint32; creator min corrected from 0 to 1 | Inline + parser; selected epoch also bounded against chain state |
| Service credit asset | Address; zero allowed to denote native ETH | Inline + pattern + existing registry/asset checks |
| Proof leaf/account/TWAB/amount/proof | Readonly, supplied by proof service | Existing proof and canonical state checks; no editable financial data |
| Markets / Stock / position searches | Free text filtering; select filters use fixed options | Existing empty/no-match results; not rejected as malformed transaction inputs |
| Home / Stats / Docs / legal pages | No additional editable transaction fields | Buttons/select state and read-only unavailable states remain |

Implementation: `src/ui/fieldValidation.ts` is mounted per route and detached on unmount. Dynamic fields share delegated events. Amount precision is obtained from the current Quote/Stock metadata; a selection change revalidates touched controls. API and chain guards continue to run even when a field passes browser validation.

Verification:
- `npm test`: 177 passed, including required/zero/range/precision/uint256/uint32/URL and disabled-state cases.
- Integration build: passed (existing bundle-size advisory only).
- Browser: whitespace name, illegal ticker, foreign X profile, javascript website, exponent trade amount, slippage 5001, negative stake and short market ID all produced inline messages; four corrected Create fields cleared invalid states.
- No wallet signing, contract writes or historical scans for this audit. Live reward proofs/settlement flows were reviewed in code, not exercised as real transactions.
