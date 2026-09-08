package deployment

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestExportCandidateConfigFixture(t *testing.T) {
	dir := os.Getenv("TG_TEST_EXPORT_CONFIG_FIXTURE")
	if dir == "" {
		t.Skip("fixture export not requested")
	}
	f, b, id, _ := configQuoteTemplateSetup(t)
	batch, e := ObserveConfigBlock(context.Background(), f, f.manifest, b, []ConfigTarget{{Kind: "quote", ID: id}, {Kind: "baseline", ID: id}, {Kind: "template", ID: id}})
	if e != nil {
		t.Fatal(e)
	}
	codes := map[string][]byte{}
	for _, c := range f.manifest.Contracts {
		codes[c.Address] = []byte{0}
	}
	data, e := json.MarshalIndent(map[string]any{"manifest": f.manifest, "block": b, "observations": batch, "calls": f.calls, "codes": codes}, "", "  ")
	if e != nil {
		t.Fatal(e)
	}
	if e := os.MkdirAll(dir, 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(dir, "configs.json"), append(data, '\n'), 0644); e != nil {
		t.Fatal(e)
	}
}
