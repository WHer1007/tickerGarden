# Continuous Holder reconciliation

The `internal/holderledger` package now provides a bounded, read-only reconciliation step for the continuous 24-hour Holder distributor. It compares a supplied action replay in the integer ledger with independently read finalized chain state at one fixed block.

The entry point is `(*holderledger.Ledger).Reconcile` in `services/backend-go/internal/holderledger/reconcile.go`. The replay uses `Apply` and `ApplyTrace` from `ledger.go` and `trace.go`; call traces include silent checkpoints and zero-amount claims, enforce the distributor and token callback senders, require the FeeVault sender for funding, and ignore reverted subtrees atomically. ABI failures and action failures leave the replay unchanged.

The stable read-only command is `services/backend-go/cmd/holder-reconcile`:

```text
holder-reconcile --describe
holder-reconcile --once REPLAY.json
```

`TG_HOLDER_RPC_URL` is preferred; when unset, the command falls back to `TG_RPC_URL`. The replay file is operator supplied and is not authenticated history. The output includes an `inputDigest`, which binds the result to the exact input file bytes; it does not authenticate those bytes or establish history completeness.

## What the fixed-block check verifies

`Reconcile` applies a 30-second context deadline and requires an explicit `ReconcileConfig` with:

- chain ID and genesis hash;
- distributor/vault binding and Quote address;
- expected distributor and token runtime code hashes;
- `MaxAccounts` between 1 and 10,000.

It rechecks the chain ID, genesis header, target block header, and finalized header before reading state. It verifies the target block is finalized, checks both runtime code hashes at the target block, verifies token `treasuryDistributor`, market ID, continuous reward mode, and 24-hour duration, and compares the complete bounded exclusion inventory.

For every account present in the replay, including excluded accounts, it reads token `balanceOf` and distributor `claimable` at the exact target block. It also compares market storage (`updatedAt`, `head`, stream count, supply, index, remainder, rate, idle, funded, paid), `releaseState` (`unreleased`, `idleQuote`, `nextEnd`, `activeStreams`), `lastFundingAt`, and token `totalSupply`. A final commit fence rechecks chain ID, genesis, target block, and the exact finalized anchor after all reads. There is no sampling and no latest-block fallback.

The report returns `AccountsChecked`, `FieldsMatched`, `DifferenceCount`, and `Differences`. Differences are sorted and capped at 64 entries while `DifferenceCount` retains the total. Any RPC, identity, codehash, finality, timeout, ABI, or commit-fence failure returns unavailable rather than a partial report.

## What it cannot prove

This is a fixed-block consistency check for the supplied replay. It does not authenticate the replay’s initial registration state or prove that the supplied trace/event history is complete from reward enablement. It does not enumerate undiscovered accounts or prove that private account storage was fully covered. It does not independently establish FeeVault solvency, all distributor assets, historical reorg-free coverage, receipt completeness, or publication readiness. A successful match therefore leaves `PublicationEligible=false` by design.

The command accepts at most 4 MiB of JSON with unknown fields rejected, 4,096 actions, and a complexity budget of `(actions + 1) * MaxAccounts <= 1,000,000`; `MaxAccounts` itself is capped at 10,000. Exceeding any limit is invalid input and must stop downstream publication. The 10,000-account limit is an explicit reconciliation budget boundary. Operators must obtain complete canonical history and initial balances through the surrounding journal/readmodel pipeline before treating this report as evidence for D02. The report is not an authorization to publish a snapshot or settle funds.

Exit status is `0` for `--describe` or a completed comparison with zero differences. Zero differences mean only that the supplied replay matched the checked fields; they do not mean history is authenticated or that publication is eligible. Exit status `2` means the comparison completed and found one or more differences. Exit status `1` means unavailable/invalid input, including RPC, finality, identity, codehash, timeout, or budget failure.

The replay shape is readable below. The addresses and hashes are placeholders and must be replaced with validated values; this is documentation only and is not directly executable:

```json
{
  "config": {
    "chainId": 0,
    "genesisHash": "0x<64-hex>",
    "binding": {"distributor": "0x<40-hex>", "vault": "0x<40-hex>"},
    "quote": "0x<40-hex>",
    "distributorCodeHash": "0x<64-hex>",
    "tokenCodeHash": "0x<64-hex>",
    "maxAccounts": 10000
  },
  "registration": {
    "marketId": "0x<64-hex>",
    "token": "0x<40-hex>",
    "totalSupply": "<decimal>",
    "timestamp": 0,
    "excluded": ["0x<40-hex>"],
    "balances": {"0x<40-hex>": "<decimal>"}
  },
  "actions": [
    {"kind": "fund", "timestamp": 0, "amount": "<decimal>"},
    {"kind": "transfer", "timestamp": 1, "from": "0x<40-hex>", "to": "0x<40-hex>", "amount": "<decimal>"},
    {"kind": "claim", "timestamp": 86400, "account": "0x<40-hex>", "amount": "<decimal>"}
  ],
  "block": {"number": "0x<hex>", "hash": "0x<64-hex>", "timestamp": "0x<hex>", "parentHash": "0x<64-hex>"}
}
```

The current implementation performs per-account `balanceOf` and `claimable` reads but does not read a separate distributor account-storage struct. Those reads must not be described as proof of private storage completeness. Production signer, RPC, database, deployment, load, and end-to-end publication acceptance remain separate gates.
