package deployment

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func TestExportHolderCandidateFixtures(t *testing.T) {
	dir := os.Getenv("TG_TEST_EXPORT_HOLDER_FIXTURES")
	if dir == "" {
		t.Skip("fixture export not requested")
	}
	if e := os.MkdirAll(dir, 0755); e != nil {
		t.Fatal(e)
	}
	for _, continuous := range []bool{false, true} {
		var f *feeFixture
		var block chainrpc.Header
		var markets map[string]MarketDiscovery
		var id string
		if continuous {
			f, block, markets, _, _, id = continuousSetup(t, true)
		} else {
			f, block, markets, _ = holderSetup(t)
			for id = range markets {
			}
		}
		registry := ""
		for _, c := range f.manifest.Contracts {
			if c.Module == "MarketRegistryV1" {
				registry = c.Address
			}
		}
		key := registry + Hash([]byte("market(bytes32)"))[:10] + id[2:]
		raw := append([]byte{}, f.calls[key]...)
		copy(raw[12*32:13*32], addrWord(markets[id].State["quoteAsset"].(string)))
		copy(raw[15*32:16*32], bytesWord("1"))
		f.calls[key] = raw
		// Export the production HTTP decoder's output, not a hand-written candidate.
		client, _ := holderCoverageHTTPFixture(t, f, block, "")
		batch, e := ObserveVerifiedKnownHolders(context.Background(), client, f.manifest, block, []string{id})
		if e != nil {
			t.Fatal(e)
		}
		data, e := json.MarshalIndent(batch, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		name := "epoch.json"
		if continuous {
			name = "continuous.json"
		}
		if e := os.WriteFile(filepath.Join(dir, name), append(data, '\n'), 0644); e != nil {
			t.Fatal(e)
		}
	}
}
