package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadHolderScopesStrictInput(t *testing.T) {
	if scopes, err := loadHolderScopes("", false); err != nil || scopes == nil || len(scopes) != 0 {
		t.Fatal("optional empty scope inventory rejected", err)
	}
	if scopes, err := loadHolderScopes("", true); err == nil || scopes != nil {
		t.Fatal("required scope inventory accepted")
	}
	for _, raw := range []string{"null", "[] {}", `[{"unexpected":true}]`} {
		path := filepath.Join(t.TempDir(), "scopes.json")
		if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
			t.Fatal(err)
		}
		if scopes, err := loadHolderScopes(path, false); err == nil || scopes != nil {
			t.Fatal("accepted invalid Holder scope input", raw)
		}
	}
}
