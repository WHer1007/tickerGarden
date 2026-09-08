package content

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeImportObject(t *testing.T, dir string, raw []byte, ext string) string {
	t.Helper()
	name := Digest(raw) + ext
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return name
}

func TestScanImportAcceptsBytePreservingMetadataAndDeterministicReport(t *testing.T) {
	origin := "https://example.com"
	bundle, err := Build(metadataJSON(`,"image":"`+encodedImage(t, "png", 2, 3)+`"`), origin)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	imageName := writeImportObject(t, dir, bundle.Image.Data, ".png")
	// This is semantically equivalent legacy metadata with deliberately different
	// whitespace and field order. ScanImport must retain these exact bytes.
	legacy := []byte("{\n  \"description\": \"A token\",\n  \"properties\": {\n    \"launch\": {\"creatorTaxBps\":25,\"creatorFeesToHolders\":true},\n    \"x\": null, \"website\": null\n  },\n  \"image\": \"" + origin + "/launch-metadata/" + imageName + "\",\n  \"symbol\": \"GRDN\",\n  \"name\": \"Garden\"\n}")
	metadataName := writeImportObject(t, dir, legacy, ".json")
	p, err := ScanImport(context.Background(), dir, origin)
	if err != nil {
		t.Fatal(err)
	}
	if got := p.objects[0].Data; !bytes.Equal(got, legacy) && !bytes.Equal(p.objects[1].Data, legacy) {
		t.Fatal("metadata bytes were rewritten")
	}
	p2, err := ScanImport(context.Background(), dir, origin)
	if err != nil {
		t.Fatal(err)
	}
	r1, r2 := p.Report(), p2.Report()
	a, _ := json.Marshal(r1)
	b, _ := json.Marshal(r2)
	if !bytes.Equal(a, b) || p.Digest() != p2.Digest() {
		t.Fatal("report or digest is not deterministic")
	}
	if !strings.HasSuffix(metadataName, ".json") || r1.TotalBytes != len(legacy)+len(bundle.Image.Data) {
		t.Fatal("unexpected report")
	}
}

func TestScanImportRejectsInvalidReferencesAndEntries(t *testing.T) {
	origin := "https://example.com"
	bundle, err := Build(metadataJSON(`,"image":"`+encodedImage(t, "png", 1, 1)+`"`), origin)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name   string
		mutate func(string, string)
	}{
		{"missing reference", func(d, _ string) {
			raw := []byte(`{"name":"Garden","symbol":"GRDN","description":"A token","image":"` + origin + `/launch-metadata/` + strings.Repeat("0", 64) + `.png","properties":{"launch":{"creatorFeesToHolders":true,"creatorTaxBps":25}}}`)
			writeImportObject(t, d, raw, ".json")
		}},
		{"wrong hash", func(d, _ string) {
			os.WriteFile(filepath.Join(d, strings.Repeat("0", 64)+".png"), bundle.Image.Data, 0600)
		}},
		{"unrecognized file", func(d, _ string) { os.WriteFile(filepath.Join(d, strings.Repeat("0", 64)+".txt"), []byte("x"), 0600) }},
		{"duplicate nested JSON", func(d, _ string) {
			raw := []byte(`{"name":"Garden","symbol":"GRDN","description":"A token","properties":{"x":null,"website":null,"launch":{"creatorFeesToHolders":true,"creatorTaxBps":25,"creatorTaxBps":25}}}`)
			writeImportObject(t, d, raw, ".json")
		}},
		{"origin mismatch", func(d, _ string) {
			raw := []byte(`{"name":"Garden","symbol":"GRDN","description":"A token","image":"https://other.example/launch-metadata/x.png","properties":{"launch":{"creatorFeesToHolders":true,"creatorTaxBps":25}}}`)
			writeImportObject(t, d, raw, ".json")
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := t.TempDir()
			tc.mutate(d, "")
			if _, err := ScanImport(context.Background(), d, origin); err == nil {
				t.Fatal("accepted invalid import")
			}
		})
	}
	t.Run("symlink", func(t *testing.T) {
		d := t.TempDir()
		target := filepath.Join(t.TempDir(), "target")
		os.WriteFile(target, bundle.Image.Data, 0600)
		os.Symlink(target, filepath.Join(d, Digest(bundle.Image.Data)+".png"))
		if _, err := ScanImport(context.Background(), d, origin); err == nil {
			t.Fatal("accepted symlink")
		}
	})
}
