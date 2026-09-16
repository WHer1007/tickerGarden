# Test Rewards Operations

This runbook covers the local test-only holder rewards worker. It is not a production or mainnet operating procedure. The worker is restricted by its environment checks to the configured Robinhood test release (`TG_PROFILE=test`, chain ID `46630`).

## Service commands

Use the supervisor from the repository root:

```sh
node tools/holder-rewards/service.mjs status
node tools/holder-rewards/service.mjs install
```

`status` reads the worker journal and reports the last attempt, last success, failures, markets, and transaction receipt summaries. `install` writes the local macOS LaunchAgent and starts the worker with `--execute --run`; it preserves the journal when replacing a stale worker. It does not install a production service. The state directory and signer path come from `.env.test.local`; do not put credentials in this document or in the journal.

## Four-hour processing policy

The worker checks the all-markets maintenance result every four hours (`TG_HOLDER_INTERVAL_SECONDS=14400`), and stores the next eligible check per market. It does not require a full chain scan. A Growing market first sweeps accrued Curve fees when the configured dust threshold is met. A Bloomed market processes Creator and Staker beneficiary conversion candidates in batches of up to 32. Holder stream funding is considered independently and remains subject to the 64-stream capacity limit, the configured asset dust threshold, and at least four hours since the market's last injection.

The 24-hour Holder release window is unchanged: it starts when a stream is funded and is based on eligible balance during that release. A four-hour worker check is only scheduling cadence; it does not shorten or restart an existing stream.

## Recovery and failure handling

The journal is durable state. Do not delete it and do not automatically replace a nonce. A pending signed intent is recovered by checking and, when necessary, resubmitting the same signed transaction bytes. A consumed nonce, missing expected receipt event, or `needs_attention` transaction blocks further sends and requires manual reconciliation. A confirmed revert records its gas cost and failure; the affected market can be retried at the next scheduled check.

Market or RPC failures are recorded as `RETRY_REQUIRED`; the market is retried in the next four-hour cycle. `DUST`, `CAPACITY`, and `INTERVAL` are deferred states, not successful funding. Normal restart respects the last persisted check time. Recovery of a pending signed intent may run immediately so its transaction status can be settled.

## Test-only budget boundary

Gas limits and rolling budget come from `.env.test.local` (`TG_HOLDER_MAX_TX_GAS_WEI` and `TG_HOLDER_DAILY_GAS_WEI`). The configured master path is not enabled. These are test-operation limits, not protocol parameters or a promise that a transaction will be broadcast.
