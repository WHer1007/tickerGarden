package principal

import (
	"strings"
	"testing"
)

func TestSnapshotRestoreRoundTripAndContinuation(t *testing.T) {
	l := New()
	if err := l.Apply(ev("StockDeposited", testAsset, "", "10")); err != nil {
		t.Fatal(err)
	}
	raw, err := l.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	r, err := Restore(raw)
	if err != nil {
		t.Fatal(err)
	}
	raw2, err := r.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(raw2) {
		t.Fatal("snapshot round trip changed bytes")
	}
	cont := ev("StockDeposited", testAsset, "", "5")
	if err := l.Apply(cont); err != nil {
		t.Fatal(err)
	}
	if err := r.Apply(cont); err != nil {
		t.Fatal(err)
	}
	a, _ := l.Snapshot()
	b, _ := r.Snapshot()
	if string(a) != string(b) {
		t.Fatal("restored continuation diverged")
	}
}

func TestRestoreRejectsMalformedAndInconsistentSnapshots(t *testing.T) {
	valid := `{"accounts":[{"assetUid":"0x1111111111111111111111111111111111111111111111111111111111111111","user":"0x2222222222222222222222222222222222222222","deposited":"10","allocated":"0","free":"10"}],"allocations":[]}`
	for _, raw := range []string{
		valid[:len(valid)-1] + `,"x":1}`,
		`{"accounts":[{"assetUid":"0x1111111111111111111111111111111111111111111111111111111111111111","user":"0x2222222222222222222222222222222222222222","deposited":"10","allocated":"0","free":"9"}],"allocations":[]}`,
		`{"accounts":[],"allocations":[{"assetUid":"0x1111111111111111111111111111111111111111111111111111111111111111","user":"0x2222222222222222222222222222222222222222","marketId":"0x3333333333333333333333333333333333333333333333333333333333333333","amount":"1"}]}`,
	} {
		if _, err := Restore([]byte(raw)); err == nil {
			t.Fatalf("accepted malformed snapshot: %s", raw)
		}
	}
}

func TestCheckpointAllocationsAndCanonicalEncoding(t *testing.T) {
	l := New()
	if e := l.Apply(ev("StockDeposited", testAsset, "", "10")); e != nil {
		t.Fatal(e)
	}
	if e := l.Apply(ev("AllocationLocked", testAsset, testMarket, "4")); e != nil {
		t.Fatal(e)
	}
	raw, e := l.Snapshot()
	if e != nil {
		t.Fatal(e)
	}
	restored, e := Restore(raw)
	if e != nil {
		t.Fatal(e)
	}
	release := ev("AllocationReleased", testAsset, testMarket, "4")
	release.Args["userMarketAllocation"] = "0"
	release.Args["userTotalAllocated"] = "0"
	for _, ledger := range []*Ledger{l, restored} {
		if e := ledger.Apply(release); e != nil {
			t.Fatal(e)
		}
	}
	a, _ := l.Snapshot()
	b, _ := restored.Snapshot()
	if string(a) != string(b) {
		t.Fatal("allocation continuation diverged")
	}
	for _, bad := range []string{string(raw) + " ", string(raw) + "{}", strings.Replace(string(raw), `"amount":"4"`, `"amount":"3"`, 1), strings.Replace(string(raw), `"accounts":`, `"accounts":[],"accounts":`, 1)} {
		if _, e := Restore([]byte(bad)); e == nil {
			t.Fatal("accepted noncanonical or inconsistent checkpoint")
		}
	}
}
