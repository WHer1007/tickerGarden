These controlled HTTP RPC fixtures are exported from deployment.routeFixture,
covering both Curve and graduated Pool routes. They are not chain observations.
Regenerate from services/backend-go:

```
TG_TEST_EXPORT_ROUTE_FIXTURES="$PWD/cmd/candidate-inspect/testdata/routes" go test ./internal/deployment -run '^TestExportCandidateRouteFixtures$' -count=1
```

The candidate tests use the actual chainrpc HTTP client and route observer,
checking hash-pinned requests and rejecting changed candidate router addresses.
