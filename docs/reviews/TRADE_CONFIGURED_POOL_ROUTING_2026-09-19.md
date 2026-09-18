# Trade configured-pool routing — 2026-09-19

Status: deployed to test and production; see [release acceptance](DEPLOYMENT_2026-09-19.md). No mainnet transactions broadcast during verification. No project contract change or database migration is required.

## Behavior

- Buy payment options are the market's paired asset plus ETH, deduplicated. ETH pairs show only ETH; USDG pairs show USDG and ETH; Stock pairs show that Stock and ETH. USDG can remain an internal bridge currency without appearing as an extra payment option.
- Paying in the paired asset uses the existing project buy route. ETH conversion uses the reviewed pool manifest and Universal Router, without 0x API calls or credentials.
- ETH amount is fixed. Backend quotes the configured V3/V4 route at one block and applies a 1% output tolerance across the complete conversion. Frontend constructs deterministic calldata from the same manifest; arbitrary provider transaction data is not accepted. The router runtime code hash is checked before execution.
- The existing confirmation shows both conversion and project-buy minimum amounts. Refreshing a quote cannot reduce a minimum the user confirmed. A failed/cancelled second leg retains the paired asset in the wallet. Positive conversion surplus above the reviewed expected amount remains in the wallet, preserving existing behavior.
- Conversion recovery records identify the router destination. Old AllowanceHolder recovery records remain recognized, but new buys never request 0x quotes. Receipt reconciliation avoids repeating a completed conversion.
- Existing payment icons, balance-row purchase entry and transaction UI remain in place; no new UI component.

## SEED route

For market `0x01f5eb9ec14492bcefcc4598d9ac8ed3f1c2a2e7eca7b217b2e7b60576448476`, the first transaction follows ETH/WETH → USDG → AAPL using the configured V3 pools. The second transaction buys SEED from its existing Growing curve after the required AAPL approval. These are sequential wallet transactions, not one atomic transaction or one signature.

## Verification

- Frontend complete test command: 640 tests passed.
- Backend complete test command: generated artifacts, packaging, contract checks, typecheck and 210 unit tests passed.
- Environment/deployment-boundary checks: 25 tests passed. Pool conversion no longer requires `ZEROX_API_KEY` at the deployment gate.
- Frontend/backend builds passed; frontend budget, lazy-load and SEO checks passed.
- Read API tested against the local fork without a 0x key: HTTP 200, `cache-control: no-store`, configured-pool quote accepted by frontend transaction validation.
- Mainnet fork pinned at block **66401542**; result file `outputs/reviews/trade-conversion/pool-fork-66401542.json`. Seven scenarios passed: USDG conversion; AAPL conversion; AAPL→SEED including failed-buy retention and successful retry; additional V3 direct and USDG-bridge routes; V4 native and USDG-bridge routes. Each conversion checked minimum token receipt and exact ETH spending excluding gas. This covers route shapes, not every Stock's current liquidity depth.
- Fork upstream was the existing mainnet RPC through the read-only pinned compatibility proxy. All signing and sends occurred only on localhost Anvil. The harness mines a local block under Cancun before simulation to provide compatible EVM/block fields.

## Rollout

Publish the backend and frontend together through the normal test → master deployment process, including Singapore runtime verification. A pending legacy wallet journal must remain recoverable across the release. Production received this implementation in release `ea6c8af6e9`; see the release acceptance report.

The previous SEED diagnosis remains historical evidence of the old 0x path. Its missing-key requirement is superseded for this new Trade route; adding the key is not required to enable configured-pool conversion.
