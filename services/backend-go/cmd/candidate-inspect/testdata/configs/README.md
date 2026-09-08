Controlled quote/baseline/template RPC evidence, exported from the deployment
configuration tests. This is not a public-chain snapshot. Regenerate from
services/backend-go:

```
TG_TEST_EXPORT_CONFIG_FIXTURE="$PWD/cmd/candidate-inspect/testdata/configs" go test ./internal/deployment -run '^TestExportCandidateConfigFixture$' -count=1
```
