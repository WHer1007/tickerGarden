package tokendetail

import "testing"

func TestConfiguredDune(t *testing.T) {
	for _, mode := range []string{"", "indexer"} {
		d, err := ConfiguredDune(mode, "", "saved-but-unused-key")
		if err != nil || d != nil {
			t.Fatalf("%q must not initialize Dune from a saved credential", mode)
		}
	}
	if _, err := ConfiguredDune("dune-first", "", "key"); err == nil {
		t.Fatal("explicit Dune mode requires a query ID")
	}
	if d, err := ConfiguredDune("dune-first", "123", "key"); err != nil || d == nil {
		t.Fatal("complete explicit Dune configuration should initialize")
	}
	if _, err := ConfiguredDune("typo", "123", "key"); err == nil {
		t.Fatal("unknown source must fail configuration")
	}
}
