package deployment

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"tickergarden/backend/internal/events"
)

// Explicit fixture regeneration for the candidate command's HTTP integration.
func TestExportCandidateRouteFixtures(t *testing.T) {
	dir := os.Getenv("TG_TEST_EXPORT_ROUTE_FIXTURES")
	if dir == "" {
		t.Skip("fixture export not requested")
	}
	if e := os.MkdirAll(dir, 0755); e != nil {
		t.Fatal(e)
	}
	for _, graduated := range []bool{false, true} {
		f, b, id, _ := routeFixture(t, graduated)
		batch, e := ObserveMarketRoute(context.Background(), f, f.manifest, b, id)
		if e != nil {
			t.Fatal(e)
		}
		registry := ""
		codes := map[string][]byte{}
		for _, c := range f.manifest.Contracts {
			codes[c.Address] = []byte{0}
			if c.Module == "MarketRegistryV1" {
				registry = c.Address
			}
		}
		for address, code := range f.code {
			codes[address] = code
		}
		state, e := events.DecodeStatic(marketFields, f.calls[registry+Hash([]byte("market(bytes32)"))[:10]+id[2:]])
		if e != nil {
			t.Fatal(e)
		}
		data, e := json.MarshalIndent(map[string]any{"manifest": f.manifest, "block": b, "marketId": id, "state": state, "observations": batch, "calls": f.calls, "codes": codes}, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		name := "curve.json"
		if graduated {
			name = "pool.json"
		}
		if e := os.WriteFile(filepath.Join(dir, name), append(data, '\n'), 0644); e != nil {
			t.Fatal(e)
		}
	}
}
