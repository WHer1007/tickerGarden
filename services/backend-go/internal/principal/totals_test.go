package principal

import (
	"reflect"
	"strings"
	"testing"
)

func applyTotalsEvent(t *testing.T, l *Ledger, name, asset, user, market, amount string) {
	t.Helper()
	e := ev(name, asset, market, amount)
	e.Args["user"] = user
	if err := l.Apply(e); err != nil {
		t.Fatal(err)
	}
}

func TestAssetTotalsSumsEachAccountOnceAcrossAllocations(t *testing.T) {
	l := New()
	user2 := "0x" + strings.Repeat("4", 40)
	applyTotalsEvent(t, l, "StockDeposited", testAsset, testUser, "", "100")
	applyTotalsEvent(t, l, "AllocationLocked", testAsset, testUser, testMarket, "30")
	applyTotalsEvent(t, l, "StockDeposited", testAsset, user2, "", "50")
	second := ev("AllocationLocked", testAsset, "0x"+strings.Repeat("5", 64), "20")
	second.Args["userMarketAllocation"] = "20"
	second.Args["userTotalAllocated"] = "50"
	if err := l.Apply(second); err != nil {
		t.Fatal(err)
	}

	want := []AssetTotal{{AssetUID: testAsset, Deposited: "150", Allocated: "50", Free: "100", Accounts: 2}}
	if got := l.AssetTotals(); !reflect.DeepEqual(got, want) {
		t.Fatalf("totals: got %#v, want %#v", got, want)
	}
}

func TestAssetTotalsKeepsAssetsSeparateAndOrdered(t *testing.T) {
	assetA := "0x" + strings.Repeat("a", 64)
	assetB := "0x" + strings.Repeat("b", 64)
	l := New()
	applyTotalsEvent(t, l, "StockDeposited", assetB, testUser, "", "9")
	applyTotalsEvent(t, l, "StockDeposited", assetA, testUser, "", "20")
	applyTotalsEvent(t, l, "AllocationLocked", assetA, testUser, testMarket, "7")

	want := []AssetTotal{
		{AssetUID: assetA, Deposited: "20", Allocated: "7", Free: "13", Accounts: 1},
		{AssetUID: assetB, Deposited: "9", Allocated: "0", Free: "9", Accounts: 1},
	}
	if got := l.AssetTotals(); !reflect.DeepEqual(got, want) {
		t.Fatalf("totals: got %#v, want %#v", got, want)
	}
}

func TestAssetTotalsAggregateExceedsUint256(t *testing.T) {
	max := "115792089237316195423570985008687907853269984665640564039457584007913129639935"
	user2 := "0x" + strings.Repeat("4", 40)
	l := New()
	applyTotalsEvent(t, l, "StockDeposited", testAsset, testUser, "", max)
	applyTotalsEvent(t, l, "StockDeposited", testAsset, user2, "", max)
	wantDeposited := "231584178474632390847141970017375815706539969331281128078915168015826259279870"
	want := []AssetTotal{{AssetUID: testAsset, Deposited: wantDeposited, Allocated: "0", Free: wantDeposited, Accounts: 2}}
	if got := l.AssetTotals(); !reflect.DeepEqual(got, want) {
		t.Fatalf("totals: got %#v, want %#v", got, want)
	}
}

func TestAssetTotalsEmptyIsNonNil(t *testing.T) {
	got := New().AssetTotals()
	if got == nil || len(got) != 0 {
		t.Fatalf("empty totals: %#v", got)
	}
}
