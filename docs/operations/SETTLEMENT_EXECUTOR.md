# Settlement executor operations

`settlement-executor` resumes one explicitly selected, already checked settlement job. It does not discover candidates, change fee policy, or import signing material.

## Commands and environment

Use `--describe` for a read-only capability report. It does not require a database, signer, or RPC. Execution can sign and broadcast the selected job. Apply migrations through `00070_settlement_reservation_release.sql` before starting the new executor or intent preparer. Execution requires exactly one job file:

```text
settlement-executor --once JOB.json
settlement-executor --run JOB.json
```

The job file must contain the persisted `WorkScope` and `jobKey` for the selected job. Runtime execution requires:

- `TG_SETTLEMENT_EXECUTION_POLICY`: path to the strict JSON execution-policy file (not inline JSON).
- `TG_SETTLEMENT_SIGNER_COMMAND`: an absolute executable signer command.
- `TG_SETTLEMENT_DATABASE_URL`: settlement database DSN.
- `TG_RPC_URL`: authenticated RPC endpoint suitable for submission and receipt/finality checks.

`--once` runs one pass over the selected job: it may prepare, sign, submit and inspect a receipt in that pass, then exits. It is not a dry run. `--run` repeats the same selected job until accounting is verified, a terminal reconciliation state is reached, cancellation occurs, or an error stops the loop. The executor does not select another job.

## Exit codes and state meaning

Exit code `0` means `--describe`, clean cancellation, or `accounting_verified`. Exit code `1` means invalid arguments, malformed input, unavailable configuration, database/RPC failure, or an execution error. Exit code `2` means a non-success durable state requiring inspection, including `signing_reconciliation_required` or `finalized_reverted`.

An unknown signer result is persisted as a reconciliation-required state. The executor does not automatically re-sign. An unknown submission result is observed through the existing durable submission and receipt records; it is not automatically re-sent as a new transaction. Operators must inspect durable intent, signer, submission, receipt, and execution-evidence records before any recovery action.

A finalized reverted receipt releases only the off-chain maximum-Gas reservation. It is not business success, does not produce accounting verification, and does not recycle the nonce. A finalized successful receipt still requires independent execution evidence and accounting verification before the executor returns success.

This command currently provides the explicit execution path and its durable primitives. It is not proof that candidate discovery, D01 financial publication, or D02 per-account Holder reconciliation is closed. Historical adapters and publication integration remain open. No production broadcast or real signer/RPC execution was performed while documenting this command.

The executor does not replace the legacy Root/TWAB/Merkle compatibility path; that path is outside the continuous current release boundary.
