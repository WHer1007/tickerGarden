# Holder observer fixtures

These are outputs from ObserveVerifiedKnownHolders through the production chainrpc HTTP client against local synthetic fixtures. They are not production chain evidence. Epoch mode includes a partially claimed finalized epoch and a rolled-over epoch; continuous mode includes funded and paid totals.

Regenerate from services/backend-go:

```sh
TG_TEST_EXPORT_HOLDER_FIXTURES="$PWD/internal/readmodel/testdata/holders" go test ./internal/deployment -run '^TestExportHolderCandidateFixtures$' -count=1
```

Validate compatibility:

```sh
go test -race ./internal/readmodel -run '^TestHolderObserverCandidateCompatibility$' -count=1
```
